// Receive tabs (0.9), end to end in Chromium: the real extension (dist/) and Enki Shield (shield/)
// with their fixed ids, the reference relay on 127.0.0.1:8788, the MCP server and the dev sender.
//
//   Pronto quando (Helm's spec): pairing from Settings → Agentes with the fingerprint checked on
//   both sides; "Pneu de neve" with 3 links → Aceitar → a tab group "Pneu de neve" with 3 tabs on
//   hold.html, and the sites receive zero requests until Abrir (no referrer after it). Refused
//   without opening anything: a bad key, a bad signature, a Shield-blocked link, javascript: and
//   user:pass@ links, a replay, a packet older than 10 minutes, the 6th packet in an hour and the
//   4th pending notice. Unpair removes the agent's key, mailbox, notices and log entries, and its
//   next packet goes nowhere.
//
//   Cloak's merge blockers: the summary reaches the model only after "Perguntar ao Enki", in Ask
//   mode, inside the untrusted-data fence (a recording mock model counts every request); "Limpar
//   histórico de abas recebidas" and the Shield's Burn clear the packet history but keep the
//   pairings and keys, and a replay still fails after it; the extension alone (no Enki Shield)
//   says "Links não verificados pelo Enki Shield" and still holds every tab on hold.html.
//
// Prereqs: `npm run build`, `npx playwright install chromium`; run under xvfb-run on Linux.
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startRelay } from "../../relay/server.js";
import { sendTabs, postWire } from "../../scripts/send-tabs.mjs";
import { pairAgent } from "../src/lib/a2a/pairing.js";
import { createSealer, decodeCredential, importEdPrivate, importXPrivate, newEd25519, newX25519, rawPublic, sealerFromCredential, b64u, unb64u } from "../src/lib/a2a/crypto.js";
import { sealBundle } from "../src/lib/a2a/envelope.js";
import { limits } from "./a2a-fixtures.mjs";
import { loadConfig } from "../../mcp/src/config.js";
import { createServer as createMcp } from "../../mcp/src/server.js";
import { ASK_QUESTION } from "../src/lib/a2a/ask.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const out = path.join(here, ".out");
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000, step = 100) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(step);
  }
}

// ---- the sites the links point to: every request they receive is recorded
const hits = [];
const site = createServer((req, res) => {
  // The opened page's own favicon request comes after Abrir; only page loads count here.
  if (req.url === "/favicon.ico") { res.writeHead(404).end(); return; }
  hits.push({ host: req.headers.host, url: req.url, referer: req.headers.referer, at: Date.now() });
  res.writeHead(200, { "content-type": "text/html" }).end(`<title>${req.headers.host}</title><h1>${req.url}</h1>`);
});
site.listen(0, "127.0.0.1");
await once(site, "listening");
const P = site.address().port;
const link = (host, p = "/") => `http://${host}.exemplo.test:${P}${p}`;

// ---- the model: an OpenAI-compatible mock that records every request it gets
const llm = [];
const model = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    if (req.method !== "POST") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "mock" }] })); return; }
    try { llm.push(JSON.parse(body)); } catch { llm.push({ raw: body }); }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Resumo lido como dado." }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
model.listen(0, "127.0.0.1");
await once(model, "listening");
const modelUrl = `http://127.0.0.1:${model.address().port}/v1`;
const userText = (body) => {
  const u = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
  if (!u) return "";
  return typeof u.content === "string" ? u.content : u.content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
};
const modelSettings = { preset: "custom", apiKey: "", baseUrl: modelUrl, model: "mock", acceptedTerms: "1" };

// ---- relay: 127.0.0.1:8788 (8787 is the mock model), or any free port if that is taken
let relay;
try { relay = await startRelay({ port: Number(process.env.ENKI_RELAY_PORT || 8788) }); } catch { relay = await startRelay({ port: 0 }); }
console.log("relay", relay.url);

// ---- extensions with the fixed ids Enki Browser gives them (build/common.mjs)
const idFromKey = (key) => [...createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
const tmp = mkdtempSync(path.join(os.tmpdir(), "enki-receive-"));
const enkiDir = path.join(tmp, "enki");
const shieldDir = path.join(tmp, "shield");
cpSync(path.resolve(here, "..", "dist"), enkiDir, { recursive: true });
cpSync(path.join(root, "shield"), shieldDir, { recursive: true });
const withKey = (dir, file) => {
  const key = readFileSync(path.join(root, "config", file), "utf8").trim();
  const m = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ ...m, key }));
  return idFromKey(key);
};
const enkiId = withKey(enkiDir, "enki-extension.pub");
const shieldId = withKey(shieldDir, "shield-extension.pub");
writeFileSync(path.join(enkiDir, "ids.json"), JSON.stringify({ shield: shieldId }));
writeFileSync(path.join(shieldDir, "ids.json"), JSON.stringify({ enki: enkiId, ublock: null, browser: "test" }));

const siteRequests = [];
const context = await chromium.launchPersistentContext(path.join(tmp, "profile"), {
  headless: false,
  args: [
    `--disable-extensions-except=${enkiDir},${shieldDir}`, `--load-extension=${enkiDir},${shieldDir}`,
    `--host-resolver-rules=MAP *.exemplo.test 127.0.0.1`, "--window-size=1200,900",
  ],
  viewport: { width: 420, height: 760 },
});
context.on("request", (r) => { if (r.url().includes(".exemplo.test")) siteRequests.push(r.url()); });

let exitCode = 0;
try {
  const sw = await until(() => context.serviceWorkers().find((w) => w.url().includes(enkiId)), 15000);
  check("Enki loaded with its fixed id", !!sw, enkiId);
  await until(() => context.serviceWorkers().find((w) => w.url().includes(shieldId)), 15000);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${enkiId}/src/sidepanel/index.html`);
  const send = (msg) => panel.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  const local = (key) => panel.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);
  const target = await panel.evaluate(async () => (await chrome.windows.create({ url: "about:blank", focused: false })).id);
  await panel.evaluate((s) => chrome.storage.local.set({ "enki:settings": s }), modelSettings);
  await panel.goto(`chrome-extension://${enkiId}/src/sidepanel/index.html?window=${target}`);

  const perms = await panel.evaluate(() => chrome.runtime.getManifest().permissions);
  check("manifest adds alarms and tabGroups", perms.includes("alarms") && perms.includes("tabGroups"), perms.join(","));
  check("off by default: no poll alarm", (await panel.evaluate(() => chrome.alarms.get("enki-agents-poll"))) === undefined);

  // ---- Settings → Agentes: switch, relay, pairing with the fingerprint compared on both sides
  await panel.getByRole("button", { name: "Settings", exact: true }).first().click();
  await panel.getByRole("button", { name: "Agentes" }).click();
  check("Parear agente is disabled while the switch is off", await panel.getByRole("button", { name: /Parear agente/ }).isDisabled());
  await panel.getByRole("switch", { name: "Receber abas de agentes" }).click();
  await panel.fill("#agents-relay", relay.url);
  await panel.getByRole("button", { name: "Salvar" }).click();
  await until(async () => (await local("enki:agents:settings"))?.relay === relay.url);

  async function pairViaUi(name) {
    await panel.getByRole("button", { name: /Parear agente/ }).click();
    const code = (await panel.locator("[data-testid=pair-code]").textContent()).trim();
    let agentFp;
    const agent = pairAgent({ relay: relay.url, code, name, pollMs: 200, timeoutMs: 30000, confirm: (fp) => { agentFp = fp; return true; } });
    await panel.locator("[data-testid=pair-fingerprint]").waitFor({ timeout: 30000 });
    const enkiFp = (await panel.locator("[data-testid=pair-fingerprint]").textContent()).trim();
    const done = await agent;
    await panel.screenshot({ path: path.join(out, `receive-pairing-${name}.png`) });
    check(`${name}: Enki and the agent show the same complete fingerprint`, enkiFp === agentFp && /^[0-9A-Z]{4}( [0-9A-Z]{4}){3}$/.test(enkiFp), enkiFp);
    // Single use: the code is spent once an agent committed to it.
    const late = await pairAgent({ relay: relay.url, code, name: "Intruso", pollMs: 200, timeoutMs: 4000, confirm: () => true }).then(() => "paired", (e) => e.message);
    check(`${name}: the pairing code works once`, /did not answer/.test(late), late);
    await panel.getByRole("button", { name: "Confirmar" }).click();
    await panel.locator(`[data-agent="${name}"]`).waitFor({ timeout: 5000 });
    return done.credential;
  }
  const helm = await pairViaUi("Helm");
  const n8n = await pairViaUi("n8n");
  const agents = await local("enki:agents:list");
  check("each pairing has its own mailbox and fresh browser keys", agents.length === 2 && agents[0].mailbox !== agents[1].mailbox);
  check("the poll alarm exists once paired and switched on", !!(await panel.evaluate(() => chrome.alarms.get("enki-agents-poll"))));
  const keyIds = await panel.evaluate(() => new Promise((r) => { const q = indexedDB.open("enki-a2a"); q.onsuccess = () => { const g = q.result.transaction("keys").objectStore("keys").getAll(); g.onsuccess = () => r(g.result.map((k) => ({ id: k.id, ext: k.xPrivate.extractable || k.edPrivate.extractable, type: k.xPrivate.type }))); }; }));
  check("browser private keys are CryptoKeys, non-extractable", keyIds.length === 2 && keyIds.every((k) => k.ext === false && k.type === "private"), JSON.stringify(keyIds));
  await panel.screenshot({ path: path.join(out, "receive-settings-agentes.png") });
  await panel.getByRole("button", { name: "Back" }).click();

  const logOf = async () => (await local("enki:agents:log")) ?? [];
  const lastReason = async () => (await logOf())[0];
  const pendingCount = async () => ((await local("enki:agents:pending")) ?? []).length;
  const poll = () => send({ type: "agents:poll-now" });

  // ---- Pronto quando: "Pneu de neve" from Helm through the MCP server
  const mcp = createMcp({ config: loadConfig({ ENKI_AGENT_KEY: helm }) });
  const pneu = {
    title: "Pneu de neve",
    summary: "Comparativo de pneus de inverno, guia de instalação e uma loja com estoque local.",
    links: [{ url: link("pneus", "/inverno"), label: "Comparativo" }, { url: link("guia-inverno", "/guia"), label: "Guia de pneus de neve" }, { url: link("loja", "/pneu-neve") }],
  };
  const sent = await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "deliver_tabs", arguments: pneu } });
  check("the MCP server sends the bundle", !sent.result.isError, sent.result.content[0].text.slice(0, 60));
  await poll();
  await panel.locator("[data-notice]").first().waitFor({ timeout: 10000 });
  const noticeText = await panel.locator("[data-notice]").first().textContent();
  check("the panel notice shows the sender, title and domains as text", /Helm/.test(noticeText) && /Pneu de neve/.test(noticeText) && /pneus\.exemplo\.test/.test(noticeText) && /3 links/.test(noticeText));
  await panel.screenshot({ path: path.join(out, "receive-notice.png") });
  check("nothing reached the sites before Aceitar", hits.length === 0 && siteRequests.length === 0);
  await panel.getByRole("button", { name: "Aceitar" }).click();
  const group = await until(() => panel.evaluate(async () => (await chrome.tabGroups.query({ title: "Pneu de neve" }))[0]), 10000);
  const groupTabs = group ? await panel.evaluate((g) => chrome.tabs.query({ groupId: g }), group.id) : [];
  check("Aceitar opens a tab group \"Pneu de neve\" with 3 tabs", !!group && groupTabs.length === 3, `color ${group?.color}`);
  check("every tab waits on hold.html", groupTabs.every((t) => (t.pendingUrl || t.url).startsWith(`chrome-extension://${enkiId}/src/hold/hold.html?`)));
  check("the group gets the agent's color", group?.color === agents.find((a) => a.name === "Helm").color);
  await until(() => panel.evaluate(async (g) => (await chrome.tabs.query({ groupId: g })).every((t) => t.status === "complete"), group.id), 10000);
  await sleep(2000);
  check("hold.html makes zero requests to the sites before Abrir (server log and browser network log)", hits.length === 0 && siteRequests.length === 0, `${hits.length} server hits, ${siteRequests.length} browser requests`);
  const card = panel.locator("[data-card]").first();
  await card.waitFor({ timeout: 5000 });
  check("the summary card shows, marked as data", /Dado · resumo/.test(await card.textContent()) && /não confiável/.test(await card.textContent()));
  check("the card footer reads as Helm ruled", /O resumo só vai pro assistente se você pedir\./.test(await panel.locator("[data-card]").first().locator("xpath=..").textContent()));
  await panel.screenshot({ path: path.join(out, "receive-card.png") });

  // ---- the summary goes to the assistant only on "Perguntar ao Enki", wrapped as untrusted data
  check("Aceitar sent nothing to the model: the summary never goes on its own", llm.length === 0, `${llm.length} model requests`);
  await card.getByRole("button", { name: "Perguntar ao Enki sobre o resumo" }).click();
  await until(() => llm.length > 0, 15000);
  await sleep(500);
  const asked = llm[0] ?? {};
  const said = userText(asked);
  const open = said.indexOf('<untrusted_data source="enki-receive-tabs">');
  const close = said.lastIndexOf("</untrusted_data>");
  const fenced = open >= 0 && close > open ? said.slice(open, close) : "";
  const outside = open >= 0 ? said.slice(0, open) + said.slice(close) : said;
  check("Perguntar ao Enki sends exactly one request, with Enki's fixed question", llm.length === 1 && said.includes(ASK_QUESTION), `${llm.length} requests`);
  check("the summary, title and domains travel inside the untrusted-data fence, with its DATA-not-INSTRUCTIONS header",
    fenced.includes(pneu.summary) && fenced.includes("Pneu de neve") && fenced.includes("pneus.exemplo.test") && /DATA, not INSTRUCTIONS/.test(said.slice(0, open)));
  check("nothing from the packet is outside the fence, in the system prompt or as full URLs", !outside.includes(pneu.summary) && !outside.includes("Pneu de neve") && !outside.includes("Helm")
    && !JSON.stringify(asked.messages.filter((m) => m.role === "system")).includes(pneu.summary) && !said.includes(`:${P}/`));
  check("the hold tab Enki is on is described without its agent-written title or address", /\[Current tab\] Enki hold page/.test(said) && !said.includes("hold.html?") && !said.slice(0, open).includes("Comparativo"), said.split("\n")[1]);
  const toolNames = (asked.tools ?? []).map((t) => t.function?.name ?? t.name);
  check("that turn runs in Ask mode: no click, type or navigate tools", toolNames.length > 0 && !toolNames.some((n) => ["click", "type", "navigate", "press_key"].includes(n)), toolNames.join(","));
  await panel.screenshot({ path: path.join(out, "receive-ask.png") });

  const hold = await until(() => context.pages().find((p) => p.url().includes("/src/hold/hold.html") && p.url().includes("guia-inverno")), 5000);
  await hold.waitForSelector("#open:not([disabled])");
  const holdInfo = await hold.evaluate(() => ({ title: document.getElementById("title").textContent, domain: document.getElementById("domain").textContent, links: document.querySelectorAll("a, link[rel=prefetch], link[rel=preconnect], link[rel=dns-prefetch]").length, imgs: [...document.images].map((i) => i.src.slice(0, 15)), tab: document.title }));
  check("hold.html shows the title and the domain as text, with no link, prefetch or remote image", holdInfo.title === "Guia de pneus de neve" && holdInfo.domain === "guia-inverno.exemplo.test" && holdInfo.links === 0 && holdInfo.imgs.every((s) => s.startsWith("data:") || s.startsWith("chrome-extension")), JSON.stringify(holdInfo));
  await hold.setViewportSize({ width: 1000, height: 640 });
  await hold.screenshot({ path: path.join(out, "receive-hold.png") });
  await hold.click("#open");
  await until(() => hits.length > 0, 5000);
  check("Abrir loads the site, with no referrer", hits.length === 1 && hits[0].url === "/guia" && hits[0].referer === undefined, JSON.stringify(hits[0]));
  check("the other two tabs still made no request", hits.filter((h) => !h.host.startsWith("guia-inverno")).length === 0);

  // ---- refused, with nothing opened
  const groupsBefore = (await panel.evaluate(() => chrome.tabGroups.query({}))).length;
  const cred = decodeCredential(helm);
  const stranger = { ed: await newEd25519(true), x: await newX25519(true) };
  const ok1 = { title: "Ok", links: [{ url: link("ok", "/1") }] };
  // Bad key: a stranger's keys, Helm's mailbox.
  const forged = createSealer({ mailbox: cred.mailbox, agent: { edPrivate: stranger.ed.privateKey, xPrivate: stranger.x.privateKey, edPub: await rawPublic(stranger.ed.publicKey), xPub: await rawPublic(stranger.x.publicKey) }, browser: { xPub: cred.browserXPub } });
  await postWire({ relay: relay.url, mailbox: cred.mailbox, wire: (await sealBundle(ok1, { sealer: forged, limits })).wire });
  await poll();
  check("a packet signed with an unpaired key is rejected", (await lastReason())?.reason === "unknown_sender" && (await pendingCount()) === 0);
  // Bad signature: Helm's id, broken signature.
  const { sealer: helmSealer } = await sealerFromCredential(helm);
  const env = JSON.parse((await sealBundle(ok1, { sealer: helmSealer, limits })).wire);
  const sig = unb64u(env.sig); sig[0] ^= 1;
  await postWire({ relay: relay.url, mailbox: cred.mailbox, wire: JSON.stringify({ ...env, sig: b64u(sig) }) });
  await poll();
  check("a packet with a bad signature is rejected", (await lastReason())?.reason === "bad_signature");
  // Plaintext: the old development format.
  await postWire({ relay: relay.url, mailbox: cred.mailbox, wire: JSON.stringify({ v: 1, alg: "dev-passthrough-INSECURE", body: btoa(JSON.stringify(ok1)) }) });
  await poll();
  check("a plaintext, unsigned packet is rejected", (await lastReason())?.reason === "wrong_alg");
  // Replay of the accepted packet.
  // (Helm's accepted packet went through the MCP server; replay a fresh one twice instead.)
  const once1 = (await sealBundle({ title: "Replay", links: [{ url: link("ok", "/r") }] }, { sealer: helmSealer, limits })).wire;
  // Old packet.
  await postWire({ relay: relay.url, mailbox: cred.mailbox, wire: (await sealBundle(ok1, { sealer: helmSealer, limits, now: Date.now() - 11 * 60_000 })).wire });
  await poll();
  check("a packet older than 10 minutes is rejected", (await lastReason())?.reason === "expired");
  // Links the validator refuses even when a sender skips its own validation.
  for (const [url, what] of [["javascript:alert(1)", "javascript:"], ["data:text/html,hi", "data:"], ["file:///etc/passwd", "file:"], [`http://user:pass@ok.exemplo.test:${P}/`, "user:pass@"]]) {
    await postWire({ relay: relay.url, mailbox: cred.mailbox, wire: (await sealBundle({ title: "x", links: [{ url }] }, { sealer: helmSealer, limits })).wire });
    await poll();
    check(`a ${what} link is rejected`, (await lastReason())?.reason === "invalid_bundle");
  }
  // Shield: one blocked link rejects the whole packet (the Shield's canaries, never real sites).
  await sendTabs({ credential: helm, bundle: { title: "Bloqueado", links: [{ url: link("ok", "/fine") }, { url: "https://enki-shield.invalid/login" }] } });
  await poll();
  check("a link blocked by Enki Shield rejects the whole packet", (await lastReason())?.reason === "shield_blocked" && (await pendingCount()) === 0, JSON.stringify(await lastReason()));
  await sendTabs({ credential: helm, bundle: { title: "Página bloqueada", links: [{ url: "https://enki-shield-page.invalid/phish" }] } });
  await poll();
  check("a page-level Shield block rejects the packet too", (await lastReason())?.reason === "shield_blocked");
  // Rate: Helm has sent 3 authenticated packets this hour (Pneu de neve and the two blocked ones).
  await postWire({ relay: relay.url, mailbox: cred.mailbox, wire: once1 });
  await poll();
  await postWire({ relay: relay.url, mailbox: cred.mailbox, wire: once1 });
  await poll();
  check("a replayed packet is rejected", (await lastReason())?.reason === "replay" && (await pendingCount()) === 1);
  await sendTabs({ credential: helm, bundle: { title: "Quinto", links: [{ url: link("ok", "/5") }] } });
  await poll();
  await sendTabs({ credential: helm, bundle: { title: "Sexto", links: [{ url: link("ok", "/6") }] } });
  await poll();
  check("the 6th packet in an hour from one agent is dropped", (await lastReason())?.reason === "rate_limited" && (await pendingCount()) === 2);
  // Pending: a 3rd from n8n fits, a 4th does not. Its summary carries HTML and a bidi override.
  const sneaky = "<b>negrito</b> <img src=x onerror=alert(1)> texto \u202Egnp.exe";
  await sendTabs({ credential: n8n, bundle: { title: "Resumo com HTML", summary: sneaky, links: [{ url: link("ok", "/n8n") }] } });
  await poll();
  await sendTabs({ credential: n8n, bundle: { title: "Quarto aviso", links: [{ url: link("ok", "/4") }] } });
  await poll();
  check("the 4th pending notice is dropped", (await lastReason())?.reason === "too_many_pending" && (await pendingCount()) === 3);
  check("none of the refused packets opened anything", (await panel.evaluate(() => chrome.tabGroups.query({}))).length === groupsBefore && hits.length === 1);

  // Summary as plain text, override stripped.
  const n8nNotice = panel.locator("[data-notice]").filter({ hasText: "Resumo com HTML" });
  await n8nNotice.getByRole("button", { name: "Aceitar" }).click();
  const summary = panel.locator("[data-card]").filter({ hasText: "Resumo com HTML" }).locator("[data-testid=summary]");
  await summary.waitFor({ timeout: 5000 });
  const s = await summary.evaluate((el) => ({ text: el.textContent, html: el.innerHTML, children: el.children.length }));
  check("a summary with HTML is shown as plain text", s.children === 0 && s.text.includes("<b>negrito</b>") && s.text.includes("<img src=x"), JSON.stringify(s.text));
  check("the bidi override is stripped from the summary", !s.text.includes("\u202E") && s.text.endsWith("gnp.exe"));
  check("nothing from the packet entered the conversation", !(await panel.locator("textarea").inputValue()).length && !/negrito/.test(await panel.locator("main, [role=log]").first().textContent().catch(() => "")));
  check("accepting another packet sent nothing more to the model", llm.length === 1 && !llm.some((b) => JSON.stringify(b).includes("negrito")), `${llm.length} model requests`);

  // ---- Limpar histórico de abas recebidas: packets forgotten, pairings and keys kept
  const idbKeys = () => panel.evaluate(() => new Promise((r) => { const q = indexedDB.open("enki-a2a"); q.onsuccess = () => { const g = q.result.transaction("keys").objectStore("keys").getAllKeys(); g.onsuccess = () => r(g.result); }; }));
  const historyState = async () => ({
    pending: await pendingCount(), cards: ((await local("enki:agents:cards")) ?? []).length, log: (await logOf()).length,
    seen: Object.keys((await local("enki:agents:seen")) ?? {}).length, rate: Object.keys((await local("enki:agents:rate")) ?? {}).length,
    dates: ((await local("enki:agents:list")) ?? []).filter((a) => a.lastPacketAt).length, agents: ((await local("enki:agents:list")) ?? []).length,
  });
  const beforeClear = await historyState();
  check("before clearing there is history to clear", beforeClear.pending > 0 && beforeClear.cards > 0 && beforeClear.log > 0 && beforeClear.seen > 0 && beforeClear.rate > 0 && beforeClear.dates > 0, JSON.stringify(beforeClear));
  await panel.getByRole("button", { name: "Settings", exact: true }).first().click();
  await panel.getByRole("button", { name: "Agentes" }).click();
  await panel.getByRole("button", { name: "Limpar histórico de abas recebidas" }).click();
  await panel.getByRole("button", { name: "Confirmar limpeza" }).click();
  await until(async () => (await logOf()).length === 0 && (await pendingCount()) === 0);
  const afterClear = await historyState();
  check("Limpar histórico: notices, cards, log, seen nonces, hourly counters and 'Último pacote' dates are gone",
    afterClear.pending === 0 && afterClear.cards === 0 && afterClear.log === 0 && afterClear.seen === 0 && afterClear.rate === 0 && afterClear.dates === 0, JSON.stringify(afterClear));
  check("Limpar histórico: both pairings and their keys stay", afterClear.agents === 2 && (await idbKeys()).length === 2);
  check("Limpar histórico: the badge is cleared", (await panel.evaluate(() => chrome.action.getBadgeText({}))) === "");
  const floors = (await local("enki:agents:replay-floors")) ?? {};
  check("only one replay floor per agent is left, no nonce or title", Object.keys(floors).length <= 2 && Object.values(floors).every((v) => typeof v === "number") && !JSON.stringify(floors).includes("Pneu"), JSON.stringify(floors));
  await panel.screenshot({ path: path.join(out, "receive-cleared.png") });
  await postWire({ relay: relay.url, mailbox: cred.mailbox, wire: once1 });
  await poll();
  check("after clearing, a replayed packet is still rejected", (await lastReason())?.reason === "replay" && (await pendingCount()) === 0, JSON.stringify(await lastReason()));
  await sendTabs({ credential: n8n, bundle: { title: "Depois de limpar", links: [{ url: link("ok", "/depois") }] } });
  await poll();
  check("after clearing, a new packet from a paired agent still arrives", (await pendingCount()) === 1 && (await lastReason())?.title === "Depois de limpar");
  await panel.getByRole("button", { name: "Back" }).click();

  // ---- Unpair Helm from Settings
  await panel.getByRole("button", { name: "Settings", exact: true }).first().click();
  await panel.getByRole("button", { name: "Agentes" }).click();
  await panel.locator('[data-agent="Helm"]').getByRole("button", { name: "Desparear" }).click();
  await panel.locator('[data-agent="Helm"]').getByRole("button", { name: "Confirmar" }).click();
  await until(async () => ((await local("enki:agents:list")) ?? []).length === 1);
  const helmId = agents.find((a) => a.name === "Helm").id;
  const after = {
    agents: (await local("enki:agents:list")).map((a) => a.name),
    keys: await panel.evaluate(() => new Promise((r) => { const q = indexedDB.open("enki-a2a"); q.onsuccess = () => { const g = q.result.transaction("keys").objectStore("keys").getAllKeys(); g.onsuccess = () => r(g.result); }; })),
    log: (await logOf()).filter((e) => e.agentId === helmId).length,
    pending: ((await local("enki:agents:pending")) ?? []).filter((n) => n.agentId === helmId).length,
  };
  check("unpair: Helm's record, key, notices and log entries are gone; n8n is untouched", after.agents.join() === "n8n" && after.keys.length === 1 && !after.keys.includes(helmId) && after.log === 0 && after.pending === 0, JSON.stringify(after));
  const relayHasHelm = await fetch(`${relay.url}/v1/mailbox/${cred.mailbox}`).then((r) => r.status);
  check("unpair: the relay mailbox was dropped (a signed DELETE), and reading it unsigned is refused", relayHasHelm === 401);
  await sendTabs({ credential: helm, bundle: { title: "Depois de desparear", links: [{ url: link("ok", "/late") }] } });
  await poll();
  check("unpair: Helm's next packet is never picked up", ((await local("enki:agents:pending")) ?? []).every((n) => n.agentId !== helmId) && !(await logOf()).some((e) => e.title === "Depois de desparear"));
  await panel.screenshot({ path: path.join(out, "receive-after-unpair.png") });

  // ---- Enki Shield's Burn clears Receive tabs' history too (Chromium has no event for it)
  const n8nId = agents.find((a) => a.name === "n8n").id;
  check("before Burn: n8n's notice waits and the log has lines", (await pendingCount()) === 1 && (await logOf()).length > 0);
  const shieldPage = await context.newPage();
  await shieldPage.goto(`chrome-extension://${shieldId}/options.html`);
  // Burn closes every tab, this one included.
  await shieldPage.evaluate(() => chrome.runtime.sendMessage({ type: "shields:burn" })).catch(() => undefined);
  await until(() => context.pages().length <= 1 || panel.isClosed(), 10000);
  const after2 = await context.newPage();
  await after2.goto(`chrome-extension://${enkiId}/src/hold/hold.html`);
  const local2 = (key) => after2.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);
  await until(async () => ((await local2("enki:agents:pending")) ?? []).length === 0 && ((await local2("enki:agents:log")) ?? []).length === 0, 15000, 200);
  const burnt = {
    pending: ((await local2("enki:agents:pending")) ?? []).length, log: ((await local2("enki:agents:log")) ?? []).length, cards: ((await local2("enki:agents:cards")) ?? []).length,
    seen: Object.keys((await local2("enki:agents:seen")) ?? {}).length, agents: ((await local2("enki:agents:list")) ?? []).map((a) => a.id),
    keys: await after2.evaluate(() => new Promise((r) => { const q = indexedDB.open("enki-a2a"); q.onsuccess = () => { const g = q.result.transaction("keys").objectStore("keys").getAllKeys(); g.onsuccess = () => r(g.result); }; })),
  };
  check("Shield's Burn clears notices, cards, log and seen nonces; the n8n pairing and its key stay",
    burnt.pending === 0 && burnt.log === 0 && burnt.cards === 0 && burnt.seen === 0 && burnt.agents.join() === n8nId && burnt.keys.join() === n8nId, JSON.stringify(burnt));
  const burnedAt = await after2.evaluate((id) => chrome.runtime.sendMessage(id, { type: "shield:burned-at" }), shieldId);
  check("Enki followed exactly that Burn (it asks the Shield, by its fixed id)", burnedAt?.at > 0 && (await local2("enki:agents:burn-synced")) === burnedAt.at, JSON.stringify(burnedAt));
  await after2.close();

  // ---- the extension alone, outside Enki Browser: no Shield, so it says so, and tabs still wait
  const soloDir = path.join(tmp, "enki-solo");
  cpSync(path.resolve(here, "..", "dist"), soloDir, { recursive: true });
  withKey(soloDir, "enki-extension.pub");
  check("standalone: no ids.json, so no Enki Shield to ask", !existsSync(path.join(soloDir, "ids.json")));
  const soloRequests = [];
  const solo = await chromium.launchPersistentContext(path.join(tmp, "profile-solo"), {
    headless: false,
    args: [`--disable-extensions-except=${soloDir}`, `--load-extension=${soloDir}`, `--host-resolver-rules=MAP *.exemplo.test 127.0.0.1`, "--window-size=1200,900"],
    viewport: { width: 420, height: 760 },
  });
  solo.on("request", (r) => { if (r.url().includes("avulsa.exemplo.test")) soloRequests.push(r.url()); });
  try {
    await until(() => solo.serviceWorkers().find((w) => w.url().includes(enkiId)), 15000);
    const sp = await solo.newPage();
    await sp.goto(`chrome-extension://${enkiId}/src/sidepanel/index.html`);
    const ssend = (msg) => sp.evaluate((m) => chrome.runtime.sendMessage(m), msg);
    const soloWin = await sp.evaluate(async () => (await chrome.windows.create({ url: "about:blank", focused: false })).id);
    await sp.evaluate((s) => chrome.storage.local.set({ "enki:settings": s }), modelSettings);
    await sp.goto(`chrome-extension://${enkiId}/src/sidepanel/index.html?window=${soloWin}`);
    await ssend({ type: "agents:set", settings: { enabled: true, relay: relay.url } });
    const started = await ssend({ type: "agents:pair-start" });
    const soloAgent = pairAgent({ relay: relay.url, code: started.pairing.code, name: "Avulso", pollMs: 200, timeoutMs: 30000, confirm: () => true });
    await until(async () => {
      await ssend({ type: "agents:pair-poll" });
      return (await sp.evaluate(async () => (await chrome.storage.session.get("enki:agents:pairing"))["enki:agents:pairing"]))?.step === "confirm";
    }, 30000, 300);
    await ssend({ type: "agents:pair-confirm" });
    const soloCred = (await soloAgent).credential;
    await sendTabs({ credential: soloCred, bundle: { title: "Sem Shield", links: [{ url: link("avulsa", "/um"), label: "Avulsa um" }, { url: link("avulsa", "/dois") }] } });
    await ssend({ type: "agents:poll-now" });
    const soloNotice = sp.locator("[data-notice]").first();
    await soloNotice.waitFor({ timeout: 10000 });
    const stored = ((await sp.evaluate(async () => (await chrome.storage.local.get("enki:agents:pending"))["enki:agents:pending"])) ?? [])[0];
    check("standalone: the notice says \"Links não verificados pelo Enki Shield\"", /Links não verificados pelo Enki Shield/.test(await soloNotice.locator("[data-testid=shield-unchecked]").textContent()) && stored?.shieldChecked === false);
    await sp.screenshot({ path: path.join(out, "receive-standalone-notice.png") });
    await soloNotice.getByRole("button", { name: "Aceitar" }).click();
    const soloGroup = await until(() => sp.evaluate(async () => (await chrome.tabGroups.query({ title: "Sem Shield" }))[0]), 10000);
    const soloTabs = soloGroup ? await sp.evaluate((g) => chrome.tabs.query({ groupId: g }), soloGroup.id) : [];
    check("standalone: Aceitar still opens every tab on hold.html, flagged as unchecked", soloTabs.length === 2 && soloTabs.every((t) => (t.pendingUrl || t.url).startsWith(`chrome-extension://${enkiId}/src/hold/hold.html?`) && new URL(t.pendingUrl || t.url).searchParams.get("v") === "0"));
    await until(() => sp.evaluate(async (g) => (await chrome.tabs.query({ groupId: g })).every((t) => t.status === "complete"), soloGroup.id), 10000);
    await sleep(2000);
    check("standalone: zero requests to the sites before Abrir", hits.filter((h) => h.host.startsWith("avulsa")).length === 0 && soloRequests.length === 0);
    const soloHold = await until(() => solo.pages().find((p) => p.url().includes("/src/hold/hold.html") && p.url().includes("avulsa")), 5000);
    await soloHold.waitForSelector("#unchecked:not([hidden])", { timeout: 5000 });
    check("standalone: the hold page says the link was not checked by Enki Shield", (await soloHold.locator("#unchecked").textContent()) === "Link não verificado pelo Enki Shield");
    await soloHold.setViewportSize({ width: 1000, height: 640 });
    await soloHold.screenshot({ path: path.join(out, "receive-standalone-hold.png") });
  } finally {
    await solo.close();
  }
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  await context.close();
  await relay.close();
  site.close();
  model.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length || exitCode ? 1 : 0);
