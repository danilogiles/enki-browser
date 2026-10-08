/**
 * Pairing for "Receive tabs" (Enki 0.9): a commit-reveal exchange over the relay, ending with a
 * fingerprint the user compares on both sides. Shared by the extension (browser side) and the
 * agent side (scripts/send-tabs.mjs pair, and the MCP server if it mirrors it). Dependency-free.
 *
 *   0. Enki shows a one-time code "ENKI-XXXX-XXXX" (5 minutes) and creates fresh browser keys
 *      (Ed25519 + X25519, non-extractable) and a random nB.
 *   1. agent → P_browser  commit { c = SHA-256("enki-commit-v1" ‖ lp(agentEdPub) ‖ lp(agentXPub) ‖ lp(nA)) }
 *   2. browser → P_agent  offer  { browserEdPub, browserXPub, nB }   (only for the first commit: the code is spent)
 *   3. agent → P_browser  reveal { agentEdPub, agentXPub, nA, name, sig }  encrypted to browserXPub
 *   4. both compute the fingerprint (crypto.js pairFingerprint) and show it complete; Enki saves the
 *      agent only when the user clicks Confirmar, the agent keeps its key only when its user confirms.
 * The agent commits before it sees nB and Enki reveals nB before it sees nA, so neither side (nor
 * the relay in the middle) can pick keys to make the fingerprints match: a man in the middle is
 * caught with probability 1 − 2⁻⁸⁰ when the user compares.
 * P_browser and P_agent are pairing mailboxes derived from the code (crypto.js pairMailboxIds).
 */
import {
  agentIdFor, b64u, codeError, decodeCredential, encodeCredential, mailboxIdFor, newEd25519, newX25519, openReveal,
  pairCommitment, pairFingerprint, pairMailboxIds, PAIR_VERSION, randomBytes, rawPublic, revealTranscript, sealReveal, sign,
  unb64u, verify,
} from "./crypto.js";
import { codePointLength, normalizeText } from "./validate-bundle.js";

export const PAIR_TTL_MS = 5 * 60_000;
export const MAX_AGENT_NAME = 40;

/** The agent's display name, as shown by Enki: plain text, 1–40 characters after cleaning. */
export function cleanAgentName(raw) {
  if (typeof raw !== "string") return null;
  const name = normalizeText(raw);
  return name && codePointLength(name) <= MAX_AGENT_NAME ? name : null;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ------------------------------------------------------------------ browser side

/** Step 1 received: returns the commitment bytes, or throws. */
export function browserReadCommit(msg) {
  if (!msg || msg.v !== PAIR_VERSION || msg.t !== "commit") throw codeError("malformed", "not a commit");
  return unb64u(msg.c, 32);
}

/** Step 2: what the browser posts to the agent's pairing mailbox. */
export function browserOffer({ browserEdPub, browserXPub, nB }) {
  return { v: PAIR_VERSION, t: "offer", ed: b64u(browserEdPub), x: b64u(browserXPub), nb: b64u(nB) };
}

/**
 * Step 3 received: decrypts the reveal, checks it against the commitment and the agent's
 * signature, and returns { name, agentEdPub, agentXPub, nA, agentId, fingerprint }. Throws with a
 * `code` on anything wrong (decrypt_failed, commitment_mismatch, bad_signature, bad_name, malformed).
 */
export async function browserReadReveal(msg, { browserXPrivate, browserEdPub, browserXPub, nB, code, commitment }) {
  if (!msg || msg.v !== PAIR_VERSION || msg.t !== "reveal") throw codeError("malformed", "not a reveal");
  const r = await openReveal(msg, browserXPrivate, browserXPub);
  const agentEdPub = unb64u(r?.ed, 32);
  const agentXPub = unb64u(r?.x, 32);
  const nA = unb64u(r?.na, 32);
  const sig = unb64u(r?.sig, 64);
  if (typeof r.name !== "string") throw codeError("bad_name");
  if (!same(await pairCommitment(agentEdPub, agentXPub, nA), commitment)) throw codeError("commitment_mismatch");
  const fields = { agentEdPub, agentXPub, nA, browserEdPub, browserXPub, nB, code };
  if (!(await verify(agentEdPub, sig, revealTranscript({ ...fields, name: r.name })))) throw codeError("bad_signature");
  const name = cleanAgentName(r.name);
  if (!name) throw codeError("bad_name");
  return { name, agentEdPub, agentXPub, nA, agentId: await agentIdFor(agentEdPub), fingerprint: await pairFingerprint(fields) };
}

// ------------------------------------------------------------------ agent side

/** Step 0/1 on the agent: fresh keys (extractable, they go into the agent's secret), nA and the commit. */
export async function agentStart() {
  const ed = await newEd25519(true);
  const x = await newX25519(true);
  const agentEdPub = await rawPublic(ed.publicKey);
  const agentXPub = await rawPublic(x.publicKey);
  const nA = randomBytes(32);
  const commit = { v: PAIR_VERSION, t: "commit", c: b64u(await pairCommitment(agentEdPub, agentXPub, nA)) };
  return { ed, x, agentEdPub, agentXPub, nA, commit };
}

/** Step 2 received on the agent: returns the reveal to post, the fingerprint to show, and the browser's keys. */
export async function agentAnswerOffer(state, offer, { code, name }) {
  if (!offer || offer.v !== PAIR_VERSION || offer.t !== "offer") throw codeError("malformed", "not an offer");
  const clean = cleanAgentName(name);
  if (!clean || clean !== name) throw codeError("bad_name", "use 1-40 plain characters");
  const browserEdPub = unb64u(offer.ed, 32);
  const browserXPub = unb64u(offer.x, 32);
  const nB = unb64u(offer.nb, 32);
  const fields = { agentEdPub: state.agentEdPub, agentXPub: state.agentXPub, nA: state.nA, browserEdPub, browserXPub, nB, code };
  const sig = await sign(state.ed.privateKey, revealTranscript({ ...fields, name }));
  const reveal = await sealReveal({ ed: b64u(state.agentEdPub), x: b64u(state.agentXPub), na: b64u(state.nA), name, sig: b64u(sig) }, browserXPub);
  return { reveal, browserEdPub, browserXPub, mailbox: await mailboxIdFor(browserEdPub), fingerprint: await pairFingerprint(fields) };
}

/** The credential string the agent keeps once its user confirmed the fingerprint. */
export async function agentCredential(state, answer, { relay, name }) {
  const subtle = globalThis.crypto.subtle;
  return encodeCredential({
    relay, mailbox: answer.mailbox, name, browserXPub: answer.browserXPub,
    agentEdPkcs8: new Uint8Array(await subtle.exportKey("pkcs8", state.ed.privateKey)),
    agentXPkcs8: new Uint8Array(await subtle.exportKey("pkcs8", state.x.privateKey)),
    agentEdPub: state.agentEdPub, agentXPub: state.agentXPub,
  });
}

// ------------------------------------------------------------------ agent-side driver over HTTP

const mailboxUrl = (relay, id) => `${relay.replace(/\/+$/, "")}/v1/mailbox/${encodeURIComponent(id)}`;

async function post(fetchImpl, relay, id, msg) {
  const res = await fetchImpl(mailboxUrl(relay, id), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg), redirect: "error", credentials: "omit" });
  await res.arrayBuffer().catch(() => {});
  if (!res.ok) throw new Error(`the relay refused the message (HTTP ${res.status})`);
}

async function take(fetchImpl, relay, id) {
  const res = await fetchImpl(mailboxUrl(relay, id), { method: "GET", redirect: "error", credentials: "omit" });
  if (!res.ok) throw new Error(`the relay answered HTTP ${res.status}`);
  const body = await res.json();
  return (Array.isArray(body?.envelopes) ? body.envelopes : []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

/**
 * Runs the agent's side of pairing. `confirm(fingerprint)` must show the fingerprint to the
 * agent's user and resolve true only if they confirm it matches what Enki shows.
 * Resolves with the credential string, or throws.
 */
export async function pairAgent({ relay, code, name, confirm, fetchImpl = fetch, pollMs = 2000, timeoutMs = PAIR_TTL_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const boxes = await pairMailboxIds(code);
  const state = await agentStart();
  await post(fetchImpl, relay, boxes.browser, state.commit);
  const deadline = Date.now() + timeoutMs;
  let offer = null;
  while (!offer) {
    if (Date.now() > deadline) throw new Error("Enki did not answer in time: check the code and that \"Parear agente\" is still open");
    offer = (await take(fetchImpl, relay, boxes.agent)).find((m) => m.t === "offer") ?? null;
    if (!offer) await sleep(pollMs);
  }
  const answer = await agentAnswerOffer(state, offer, { code, name });
  await post(fetchImpl, relay, boxes.browser, answer.reveal);
  if (!(await confirm(answer.fingerprint))) throw new Error("pairing cancelled: the fingerprint was not confirmed");
  return { credential: await agentCredential(state, answer, { relay, name }), fingerprint: answer.fingerprint, mailbox: answer.mailbox };
}

export { decodeCredential };
