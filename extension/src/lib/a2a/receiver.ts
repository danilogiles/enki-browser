/**
 * Receive tabs (0.9), the browser side. Runs in the service worker: polls the relay, opens and
 * checks packets, keeps notices, runs pairing, and opens the tab group when the user accepts.
 *
 * Nothing is ever sent back to an agent: no read receipt, no "accepted"/"declined". The only
 * requests are to the relay the user configured: a signed GET per paired agent once a minute while
 * "Receber abas de agentes" is on (off by default), the pairing messages, and a signed DELETE when
 * the user unpairs. Packets are untrusted data: they never reach the assistant, Act, or settings.
 */
import schema from "../../../../protocol/deliver_tabs.schema.json";
import { createBundleValidator, limitsFromSchema } from "./validate-bundle.js";
import { openEnvelope } from "./envelope.js";
import { b64u, createOpener, mailboxIdFor, newEd25519, newPairCode, newX25519, pairMailboxIds, randomBytes, rawPublic, signRelayRequest, unb64u } from "./crypto.js";
import { browserOffer, browserReadCommit, browserReadReveal, PAIR_TTL_MS } from "./pairing.js";
import { admit, checkRelay, holdQuery, nextColor, pruneSeen, pushLog } from "./policy.js";
import { deleteAgentKeys, deletePairing, getAgentKeys, getPairing, putAgentKeys, putPairing, type PairingRecord } from "./keystore";
import { shieldCheck } from "./shield";
import { DEFAULT_AGENT_SETTINGS, K, type AgentRecord, type AgentRequest, type AgentSettings, type LogEntry, type Notice, type PairingView, type SummaryCard } from "./store";
import { isValidWebNavigationUrl } from "../urls";

export const POLL_ALARM = "enki-agents-poll";
export const HOLD_PAGE = "src/hold/hold.html";
const validate = createBundleValidator(schema);
const limits = limitsFromSchema(schema);
const CARDS_MAX = 5;

// ------------------------------------------------------------------ storage helpers

async function get<T>(key: string, fallback: T): Promise<T> {
  return ((await chrome.storage.local.get(key))[key] as T | undefined) ?? fallback;
}
const set = (values: Record<string, unknown>) => chrome.storage.local.set(values);
export const getSettings = async (): Promise<AgentSettings> => ({ ...DEFAULT_AGENT_SETTINGS, ...(await get<Partial<AgentSettings>>(K.settings, {})) });
const getAgents = () => get<AgentRecord[]>(K.agents, []);
const getPending = () => get<Notice[]>(K.pending, []);

async function log(entry: LogEntry): Promise<void> {
  await set({ [K.log]: pushLog(await get<LogEntry[]>(K.log, []), entry) });
}

async function updateBadge(): Promise<void> {
  const n = (await getPending()).length;
  await chrome.action.setBadgeText({ text: n ? String(n) : "" }).catch(() => undefined);
  await chrome.action.setBadgeBackgroundColor({ color: "#38bdf8" }).catch(() => undefined);
}

/** One thing at a time: polls, pairing steps and the user's clicks never interleave. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

const relayFetch = (url: string, init: RequestInit = {}) =>
  fetch(url, { ...init, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(15000) });
const mailboxUrl = (relay: string, id: string) => `${relay}/v1/mailbox/${encodeURIComponent(id)}`;

// ------------------------------------------------------------------ alarm

/** The poll alarm exists only while the switch is on and there is something to poll. */
export async function syncAlarm(): Promise<void> {
  const settings = await getSettings();
  const pairing = await chrome.storage.session.get(K.pairing);
  const needed = settings.enabled && checkRelay(settings.relay).ok && ((await getAgents()).length > 0 || !!pairing[K.pairing]);
  const existing = await chrome.alarms.get(POLL_ALARM);
  if (needed && !existing) await chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1, delayInMinutes: 1 });
  if (!needed && existing) await chrome.alarms.clear(POLL_ALARM);
}

// ------------------------------------------------------------------ polling and packets

export function pollNow(): Promise<void> {
  return serial(async () => {
    const settings = await getSettings();
    if (!settings.enabled) return;
    if ((await chrome.storage.session.get(K.pairing))[K.pairing]) await pairStep();
    for (const agent of await getAgents()) await pollAgent(agent).catch(() => undefined);
    await updateBadge();
  });
}

async function pollAgent(agent: AgentRecord): Promise<void> {
  const keys = await getAgentKeys(agent.id);
  if (!keys) return;
  const headers = await signRelayRequest({ method: "GET", mailbox: agent.mailbox, edPrivate: keys.edPrivate, edPub: keys.edPub });
  const res = await relayFetch(mailboxUrl(agent.relay, agent.mailbox), { headers });
  if (!res.ok) return;
  const body = (await res.json().catch(() => null)) as { envelopes?: unknown } | null;
  const list = Array.isArray(body?.envelopes) ? body!.envelopes.filter((e): e is string => typeof e === "string") : [];
  for (const wire of list) await receive(agent, keys, wire);
}

/** Every check, in the threat model's order. Exported for the browser test. */
export async function receive(agent: AgentRecord, keys: { xPrivate: CryptoKey; xPub: Uint8Array }, wire: string): Promise<LogEntry> {
  const now = Date.now();
  const seen = pruneSeen(await get<Record<string, number>>(K.seen, {}), now);
  const opener = createOpener({
    mailbox: agent.mailbox,
    browser: { xPrivate: keys.xPrivate, xPub: keys.xPub },
    agent: { edPub: unb64u(agent.agentEdPub, 32), xPub: unb64u(agent.agentXPub, 32) },
    expectedFrameBytes: limits.paddedFrameBytes,
  });
  const opened = await openEnvelope(wire, { opener, validate, limits, seenNonce: (n) => n in seen, now });
  const done = async (entry: LogEntry) => { await log(entry); return entry; };
  if (!opened.ok) return done({ at: now, agentId: agent.id, outcome: "rejected", reason: opened.reason });

  // Authenticated from here: remember the nonce until the packet would be too old anyway.
  seen[opened.nonce] = opened.ts + (limits.maxPacketAgeSeconds + limits.maxClockSkewSeconds) * 1000;
  await set({ [K.seen]: seen });
  const { bundle } = opened;
  const meta = { at: now, agentId: agent.id, title: bundle.title, links: bundle.links.length };

  const rate = await get<Record<string, number[]>>(K.rate, {});
  const pending = await getPending();
  const verdict = admit({ now, recent: rate[agent.id] ?? [], pending: pending.length, limits });
  await set({ [K.rate]: { ...rate, [agent.id]: verdict.recent } });
  if (!verdict.ok) return done({ ...meta, outcome: "dropped", reason: verdict.reason });

  // Same rule as the assistant's own navigations (http/https, no internal pages), then Shield.
  if (!bundle.links.every((l) => isValidWebNavigationUrl(l.url))) return done({ ...meta, outcome: "rejected", reason: "url_not_allowed" });
  const shield = await shieldCheck(bundle.links.map((l) => l.url));
  if (!shield.ok) return done({ ...meta, outcome: "rejected", reason: shield.reason });

  const notice: Notice = { id: b64u(randomBytes(9)), agentId: agent.id, receivedAt: now, title: bundle.title, summary: bundle.summary, links: bundle.links, shieldChecked: shield.checked };
  await set({
    [K.pending]: [...pending, notice],
    [K.agents]: (await getAgents()).map((a) => (a.id === agent.id ? { ...a, lastPacketAt: now } : a)),
  });
  return done({ ...meta, outcome: "pending" });
}

// ------------------------------------------------------------------ pairing

async function mirror(p: PairingRecord | null): Promise<void> {
  if (!p) { await chrome.storage.session.remove(K.pairing); return; }
  const used = (await getAgents()).map((a) => a.color);
  let view: PairingView;
  if (p.step === "confirm" && p.candidate) view = { step: "confirm", code: p.code, exp: p.exp, name: p.candidate.name, fingerprint: p.candidate.fingerprint, color: nextColor(used) };
  else if (p.step === "failed") view = { step: "failed", code: p.code, exp: p.exp, error: p.error ?? "Falhou" };
  else view = { step: p.step === "offered" ? "offered" : "waiting", code: p.code, exp: p.exp };
  await chrome.storage.session.set({ [K.pairing]: view });
}

async function startPairing(): Promise<PairingView> {
  const settings = await getSettings();
  if (!settings.enabled) throw new Error("Ligue \"Receber abas de agentes\" primeiro");
  if (!checkRelay(settings.relay).ok) throw new Error("Configure o relay primeiro");
  // Fresh keys for this pairing only, non-extractable.
  const ed = await newEd25519(false);
  const x = await newX25519(false);
  const code = newPairCode();
  const record: PairingRecord = {
    id: "pairing", code, exp: Date.now() + PAIR_TTL_MS, nB: randomBytes(32), boxes: await pairMailboxIds(code), step: "waiting",
    edPrivate: ed.privateKey, xPrivate: x.privateKey, edPub: await rawPublic(ed.publicKey), xPub: await rawPublic(x.publicKey),
  };
  await putPairing(record);
  await mirror(record);
  await syncAlarm();
  return (await chrome.storage.session.get(K.pairing))[K.pairing] as PairingView;
}

/** Reads the pairing mailbox and advances one step. Messages after the first commit are ignored: the code is single use. */
async function pairStep(): Promise<void> {
  const p = await getPairing();
  if (!p) { await mirror(null); return; }
  if (p.step !== "confirm" && Date.now() > p.exp) { await deletePairing(); await mirror(null); await syncAlarm(); return; }
  if (p.step === "confirm" || p.step === "failed") return;
  const settings = await getSettings();
  const relay = checkRelay(settings.relay);
  if (!relay.ok) return;
  const res = await relayFetch(mailboxUrl(relay.url, p.boxes.browser));
  if (!res.ok) return;
  const body = (await res.json().catch(() => null)) as { envelopes?: unknown } | null;
  for (const raw of Array.isArray(body?.envelopes) ? body!.envelopes : []) {
    let msg: { t?: unknown };
    try { msg = JSON.parse(String(raw)); } catch { continue; }
    try {
      if (p.step === "waiting" && msg.t === "commit") {
        p.commitment = browserReadCommit(msg);
        p.step = "offered";
        await putPairing(p);
        const offer = browserOffer({ browserEdPub: p.edPub, browserXPub: p.xPub, nB: p.nB });
        await relayFetch(mailboxUrl(relay.url, p.boxes.agent), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(offer) });
      } else if (p.step === "offered" && msg.t === "reveal" && p.commitment) {
        const seen = await browserReadReveal(msg, { browserXPrivate: p.xPrivate, browserEdPub: p.edPub, browserXPub: p.xPub, nB: p.nB, code: p.code, commitment: p.commitment });
        p.candidate = { name: seen.name, fingerprint: seen.fingerprint, agentId: seen.agentId, agentEdPub: seen.agentEdPub, agentXPub: seen.agentXPub };
        p.step = "confirm";
        await putPairing(p);
        break;
      }
    } catch (e) {
      // A broken or forged step spends the code; the user starts again.
      p.step = "failed";
      p.error = (e as { code?: string }).code === "commitment_mismatch" ? "As chaves do agente não batem com o que ele prometeu" : "O agente mandou uma resposta inválida";
      await putPairing(p);
      break;
    }
  }
  await mirror(p);
}

async function confirmPairing(): Promise<AgentRecord> {
  const p = await getPairing();
  if (!p || p.step !== "confirm" || !p.candidate) throw new Error("Nada para confirmar");
  const settings = await getSettings();
  const relay = checkRelay(settings.relay);
  if (!relay.ok) throw new Error("Configure o relay primeiro");
  const agents = await getAgents();
  const record: AgentRecord = {
    id: p.candidate.agentId, name: p.candidate.name, color: nextColor(agents.map((a) => a.color)), fingerprint: p.candidate.fingerprint,
    agentEdPub: b64u(p.candidate.agentEdPub), agentXPub: b64u(p.candidate.agentXPub), mailbox: await mailboxIdFor(p.edPub), relay: relay.url, pairedAt: Date.now(),
  };
  await putAgentKeys({ id: record.id, edPrivate: p.edPrivate, xPrivate: p.xPrivate, edPub: p.edPub, xPub: p.xPub });
  await set({ [K.agents]: [...agents.filter((a) => a.id !== record.id), record] });
  await deletePairing();
  await mirror(null);
  await syncAlarm();
  return record;
}

async function cancelPairing(): Promise<void> {
  await deletePairing();
  await mirror(null);
  await syncAlarm();
}

// ------------------------------------------------------------------ unpair

/** Deletes that agent's keys, its mailbox on the relay, its notices, cards and log entries. Others are untouched. */
async function unpair(id: string): Promise<void> {
  const agents = await getAgents();
  const agent = agents.find((a) => a.id === id);
  const keys = await getAgentKeys(id);
  if (agent && keys) {
    const headers = await signRelayRequest({ method: "DELETE", mailbox: agent.mailbox, edPrivate: keys.edPrivate, edPub: keys.edPub });
    await relayFetch(mailboxUrl(agent.relay, agent.mailbox), { method: "DELETE", headers }).catch(() => undefined);
  }
  await deleteAgentKeys(id);
  const rate = await get<Record<string, number[]>>(K.rate, {});
  delete rate[id];
  await set({
    [K.agents]: agents.filter((a) => a.id !== id),
    [K.pending]: (await getPending()).filter((n) => n.agentId !== id),
    [K.cards]: (await get<SummaryCard[]>(K.cards, [])).filter((c) => c.agentId !== id),
    [K.log]: (await get<LogEntry[]>(K.log, [])).filter((e) => e.agentId !== id),
    [K.rate]: rate,
  });
  await syncAlarm();
  await updateBadge();
}

// ------------------------------------------------------------------ accept / decline

/** A normal, non-incognito window: the panel's own if it is one, otherwise any, otherwise a new one. */
async function normalWindow(preferred?: number): Promise<number> {
  if (preferred !== undefined) {
    const w = await chrome.windows.get(preferred).catch(() => null);
    if (w && !w.incognito && w.type === "normal" && w.id !== undefined) return w.id;
  }
  const all = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const w = all.find((x) => !x.incognito && x.focused) ?? all.find((x) => !x.incognito);
  if (w?.id !== undefined) return w.id;
  const created = await chrome.windows.create({ focused: true, incognito: false });
  return created!.id!;
}

async function accept(id: string, windowId?: number): Promise<{ groupId: number; tabIds: number[] }> {
  const pending = await getPending();
  const notice = pending.find((n) => n.id === id);
  if (!notice) throw new Error("Esse pacote não está mais pendente");
  const agent = (await getAgents()).find((a) => a.id === notice.agentId);
  if (!agent) throw new Error("Esse agente foi despareado");
  await set({ [K.pending]: pending.filter((n) => n.id !== id) });
  const win = await normalWindow(windowId);
  const base = chrome.runtime.getURL(HOLD_PAGE);
  const tabIds: number[] = [];
  for (const [i, l] of notice.links.entries()) {
    const tab = await chrome.tabs.create({ windowId: win, active: i === 0, url: base + holdQuery({ url: l.url, host: l.host, label: l.label, group: notice.title, sender: agent.name, color: agent.color }) });
    if (tab.id !== undefined) tabIds.push(tab.id);
  }
  if (!tabIds.length) throw new Error("Nenhuma aba foi criada");
  const groupId: number = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]], createProperties: { windowId: win } });
  await chrome.tabGroups.update(groupId, { title: notice.title, color: agent.color, collapsed: false });
  const card: SummaryCard = { id: notice.id, agentId: agent.id, title: notice.title, summary: notice.summary, hosts: notice.links.map((l) => l.host), tabs: tabIds.length, openedAt: Date.now() };
  await set({ [K.cards]: [card, ...(await get<SummaryCard[]>(K.cards, []))].slice(0, CARDS_MAX) });
  await log({ at: Date.now(), agentId: agent.id, title: notice.title, links: notice.links.length, outcome: "accepted" });
  await updateBadge();
  return { groupId, tabIds };
}

async function decline(id: string): Promise<void> {
  const pending = await getPending();
  const notice = pending.find((n) => n.id === id);
  if (!notice) return;
  await set({ [K.pending]: pending.filter((n) => n.id !== id) });
  await log({ at: Date.now(), agentId: notice.agentId, title: notice.title, links: notice.links.length, outcome: "declined" });
  await updateBadge();
}

// ------------------------------------------------------------------ messages from Enki's own pages

/** Only Enki's own pages may drive this; content scripts, web pages and the hold page may not. */
export function trustedSender(sender: chrome.runtime.MessageSender): boolean {
  const origin = chrome.runtime.getURL("");
  return sender.id === chrome.runtime.id && typeof sender.url === "string" && sender.url.startsWith(origin) && !sender.url.startsWith(origin + "src/hold/");
}

export async function handleAgentRequest(msg: AgentRequest): Promise<Record<string, unknown>> {
  switch (msg.type) {
    case "agents:set": {
      return serial(async () => {
        const current = await getSettings();
        const next = { ...current };
        if (typeof msg.settings.enabled === "boolean") next.enabled = msg.settings.enabled;
        if (typeof msg.settings.relay === "string") {
          const r = msg.settings.relay.trim() ? checkRelay(msg.settings.relay) : { ok: true as const, url: "" };
          if (!r.ok) throw new Error(r.reason);
          next.relay = r.url;
        }
        await set({ [K.settings]: next });
        if (!next.enabled) { await deletePairing(); await mirror(null); }
        await syncAlarm();
        return { settings: next };
      });
    }
    case "agents:pair-start": return serial(async () => ({ pairing: await startPairing() }));
    case "agents:pair-poll": await serial(pairStep); return {};
    case "agents:pair-confirm": return serial(async () => ({ agent: await confirmPairing() }));
    case "agents:pair-cancel": await serial(cancelPairing); return {};
    case "agents:unpair": await serial(() => unpair(msg.id)); return {};
    case "agents:poll-now": await pollNow(); return {};
    case "agents:accept": return serial(() => accept(msg.id, msg.windowId));
    case "agents:decline": await serial(() => decline(msg.id)); return {};
    case "agents:dismiss-card":
      await serial(async () => set({ [K.cards]: (await get<SummaryCard[]>(K.cards, [])).filter((c) => c.id !== msg.id) }));
      return {};
    case "agents:clear-log": await serial(() => set({ [K.log]: [] })); return {};
  }
}

export function isAgentRequest(msg: unknown): msg is AgentRequest {
  return !!msg && typeof msg === "object" && typeof (msg as { type?: unknown }).type === "string" && (msg as { type: string }).type.startsWith("agents:");
}
