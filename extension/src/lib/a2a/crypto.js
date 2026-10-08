/**
 * Cryptography for "Receive tabs" (Enki 0.9), shared by the extension (receiving side), the MCP
 * server (mcp/, sending side), the dev sender (scripts/send-tabs.mjs) and the reference relay
 * (relay/). Dependency-free ES module on WebCrypto only: Chromium 133+ and Node 20+ both have
 * Ed25519 and X25519. The format is specified in docs/0.9-receber-abas.md, "Protocolo".
 *
 * Keys. Every pairing creates fresh key pairs on both sides; nothing is per profile, so two
 * pairings cannot be linked by a key:
 *   agent   Ed25519 (signs packets)   X25519 (static half of the packet key)
 *   browser Ed25519 (signs relay fetches; its hash is the mailbox id)   X25519 (receives packets)
 * The browser's private keys are generated non-extractable and never leave its profile.
 *
 * Packet ("tabs" envelope), sealed by the agent for one paired browser:
 *   eph        = fresh X25519 key pair
 *   ikm        = X25519(eph, browserX) ‖ X25519(agentX, browserX)
 *   key        = HKDF-SHA-256(ikm, salt = ephPub ‖ browserXPub ‖ agentXPub, info = "enki-tabs-v1 key"), 32 bytes
 *   nonce      = 12 random bytes (the AES-GCM IV)
 *   ct         = AES-256-GCM(key, nonce, aad = header, paddedFrame)
 *   sig        = Ed25519(agentEd, "enki-tabs-v1\n" + v,alg,to,from,eph,nonce,ct joined by "\n")
 *   envelope   = { v: 1, alg: "enki-tabs-v1", to, from, eph, nonce, ct, sig }   (binary fields base64url)
 * The frame inside (envelope.js) carries the replay nonce and timestamp, so both are encrypted
 * and covered by the signature. The receiver checks the size cap, then the mailbox and sender id,
 * then the signature, and only then decrypts.
 */

export const TABS_ALG = "enki-tabs-v1";
export const PAIR_VERSION = 1;
const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

// ------------------------------------------------------------------ encoding

export function b64u(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strict base64url (no padding, no other characters); `length` checks the decoded size. */
export function unb64u(text, length) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw codeError("malformed", "not base64url");
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  if (length !== undefined && out.length !== length) throw codeError("malformed", `expected ${length} bytes`);
  if (b64u(out) !== text) throw codeError("malformed", "non-canonical base64url");
  return out;
}

export const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
export function unhex(text) {
  if (!/^(?:[0-9a-f]{2})*$/i.test(text)) throw new Error("not hex");
  return Uint8Array.from(text.match(/../g) ?? [], (h) => parseInt(h, 16));
}

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Length prefix: uint32 big-endian byte length, then the bytes. */
export function lp(bytes) {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Crockford base32, uppercase, no padding (5 bits per character, most significant first). */
export function crockford(bytes) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += CROCKFORD[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

export async function sha256(bytes) {
  return new Uint8Array(await subtle().digest("SHA-256", bytes));
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function codeError(code, message) {
  const e = new Error(message ? `${code}: ${message}` : code);
  e.code = code;
  return e;
}

// ------------------------------------------------------------------ identifiers

const ID_LENGTH = 22; // 132 bits of a SHA-256, base64url
export const MAILBOX_ID = /^[A-Za-z0-9_-]{22}$/;
export const PAIR_MAILBOX_ID = /^p-[A-Za-z0-9_-]{22}$/;

/** The mailbox of a pairing: derived from the browser's Ed25519 key, which signs its fetches. */
export async function mailboxIdFor(browserEdPub) {
  return b64u(await sha256(concat(enc.encode("enki-mailbox-v1"), lp(browserEdPub)))).slice(0, ID_LENGTH);
}

/** The `from` of an agent's envelopes: derived from its Ed25519 key. */
export async function agentIdFor(agentEdPub) {
  return b64u(await sha256(concat(enc.encode("enki-agent-id-v1"), lp(agentEdPub)))).slice(0, ID_LENGTH);
}

// ------------------------------------------------------------------ pairing code and fingerprint

export const PAIR_CODE = /^ENKI-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** A fresh one-time pairing code: "ENKI-" and 8 Crockford characters (40 bits). */
export function newPairCode() {
  const c = crockford(randomBytes(5));
  return `ENKI-${c.slice(0, 4)}-${c.slice(4, 8)}`;
}

/**
 * Accepts what a person types or pastes: any case, spaces, missing dashes, and the Crockford
 * look-alikes (O→0, I/L→1). Returns the canonical "ENKI-XXXX-XXXX" or null.
 */
export function normalizePairCode(input) {
  if (typeof input !== "string") return null;
  let s = input.toUpperCase().replace(/[\s-]/g, "");
  if (s.startsWith("ENKI")) s = s.slice(4);
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(s)) return null;
  return `ENKI-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Where each side listens during pairing; anyone with the code can find them, nobody else. */
export async function pairMailboxIds(code) {
  const id = async (role) => "p-" + b64u(await sha256(concat(enc.encode("enki-pair-mailbox-v1"), lp(enc.encode(role)), lp(enc.encode(code))))).slice(0, ID_LENGTH);
  return { browser: await id("browser"), agent: await id("agent") };
}

/** C = SHA-256("enki-commit-v1" ‖ lp(agentEdPub) ‖ lp(agentXPub) ‖ lp(nA)) */
export async function pairCommitment(agentEdPub, agentXPub, nA) {
  return sha256(concat(enc.encode("enki-commit-v1"), lp(agentEdPub), lp(agentXPub), lp(nA)));
}

/**
 * The fingerprint both sides show, complete, and the user compares before confirming:
 *   fp = SHA-256("enki-pair-v1" ‖ lp(agentEdPub) ‖ lp(agentXPub) ‖ lp(nA)
 *                               ‖ lp(browserEdPub) ‖ lp(browserXPub) ‖ lp(nB) ‖ lp(utf8(code)))
 * First 10 bytes (80 bits), Crockford base32 (16 characters), 4 groups of 4: "K7Q2 M9XD 4HTR 0B8W".
 * Never truncate it.
 */
export async function pairFingerprint({ agentEdPub, agentXPub, nA, browserEdPub, browserXPub, nB, code }) {
  const digest = await sha256(concat(
    enc.encode("enki-pair-v1"), lp(agentEdPub), lp(agentXPub), lp(nA),
    lp(browserEdPub), lp(browserXPub), lp(nB), lp(enc.encode(code)),
  ));
  return crockford(digest.subarray(0, 10)).match(/.{4}/g).join(" ");
}

// ------------------------------------------------------------------ keys

export async function newEd25519(extractable) {
  return subtle().generateKey({ name: "Ed25519" }, extractable, ["sign", "verify"]);
}
export async function newX25519(extractable) {
  return subtle().generateKey({ name: "X25519" }, extractable, ["deriveBits"]);
}
export async function rawPublic(key) {
  return new Uint8Array(await subtle().exportKey("raw", key));
}
const importEdPub = (raw) => subtle().importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
const importXPub = (raw) => subtle().importKey("raw", raw, { name: "X25519" }, false, []);
export const importEdPrivate = (pkcs8) => subtle().importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
export const importXPrivate = (pkcs8) => subtle().importKey("pkcs8", pkcs8, { name: "X25519" }, false, ["deriveBits"]);

async function x25519(privateKey, publicRaw) {
  // WebCrypto refuses an all-zero result (a low-order public key); treat it as a bad packet.
  try {
    return new Uint8Array(await subtle().deriveBits({ name: "X25519", public: await importXPub(publicRaw) }, privateKey, 256));
  } catch {
    throw codeError("bad_key", "X25519 failed");
  }
}

async function hkdfAesKey(ikm, salt, info) {
  const base = await subtle().importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode(info) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sign(edPrivate, bytes) {
  return new Uint8Array(await subtle().sign({ name: "Ed25519" }, edPrivate, bytes));
}
export async function verify(edPublicRaw, sig, bytes) {
  try {
    return await subtle().verify({ name: "Ed25519" }, await importEdPub(edPublicRaw), sig, bytes);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ tabs envelope

const HEADER_FIELDS = ["v", "alg", "to", "from", "eph", "nonce"];
const header = (env) => enc.encode([TABS_ALG, ...HEADER_FIELDS.map((k) => String(env[k]))].join("\n"));
const signedBytes = (env) => enc.encode([TABS_ALG, ...HEADER_FIELDS.map((k) => String(env[k])), env.ct].join("\n"));

/**
 * Sending side. `agent` = { edPrivate, xPrivate (CryptoKeys), edPub, xPub (raw) },
 * `browser` = { xPub (raw) }, `mailbox` = the pairing's mailbox id.
 * Returns a Sealer for envelope.js: seal(paddedFrame) → envelope.
 */
export function createSealer({ mailbox, agent, browser }) {
  return {
    alg: TABS_ALG,
    async seal(paddedFrame) {
      const eph = await newX25519(true);
      const ephPub = await rawPublic(eph.publicKey);
      const ikm = concat(await x25519(eph.privateKey, browser.xPub), await x25519(agent.xPrivate, browser.xPub));
      const key = await hkdfAesKey(ikm, concat(ephPub, browser.xPub, agent.xPub), `${TABS_ALG} key`);
      const nonce = randomBytes(12);
      const env = { v: 1, alg: TABS_ALG, to: mailbox, from: await agentIdFor(agent.edPub), eph: b64u(ephPub), nonce: b64u(nonce) };
      env.ct = b64u(new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce, additionalData: header(env) }, key, paddedFrame)));
      env.sig = b64u(await sign(agent.edPrivate, signedBytes(env)));
      return env;
    },
  };
}

/**
 * Receiving side, for one paired agent. `browser` = { xPrivate (CryptoKey), xPub (raw) },
 * `agent` = { edPub, xPub (raw) }. open(envelope) verifies, then decrypts; it throws an Error with
 * a `code` (wrong_mailbox, unknown_sender, malformed, bad_signature, decrypt_failed) otherwise.
 */
export function createOpener({ mailbox, browser, agent, expectedFrameBytes }) {
  let agentId;
  return {
    alg: TABS_ALG,
    async open(env) {
      agentId ??= await agentIdFor(agent.edPub);
      for (const k of ["to", "from", "eph", "nonce", "ct", "sig"]) if (typeof env[k] !== "string") throw codeError("malformed", `missing ${k}`);
      if (env.v !== 1 || env.alg !== TABS_ALG) throw codeError("malformed", "version");
      if (env.to !== mailbox) throw codeError("wrong_mailbox");
      if (env.from !== agentId) throw codeError("unknown_sender");
      const extra = Object.keys(env).filter((k) => !["v", "alg", "to", "from", "eph", "nonce", "ct", "sig"].includes(k));
      if (extra.length) throw codeError("malformed", "unexpected field");
      const ephPub = unb64u(env.eph, 32);
      const nonce = unb64u(env.nonce, 12);
      const sig = unb64u(env.sig, 64);
      const ct = unb64u(env.ct, expectedFrameBytes === undefined ? undefined : expectedFrameBytes + 16);
      // Signature first: nothing unauthenticated is decrypted.
      if (!(await verify(agent.edPub, sig, signedBytes(env)))) throw codeError("bad_signature");
      const ikm = concat(await x25519(browser.xPrivate, ephPub), await x25519(browser.xPrivate, agent.xPub));
      const key = await hkdfAesKey(ikm, concat(ephPub, browser.xPub, agent.xPub), `${TABS_ALG} key`);
      try {
        return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: nonce, additionalData: header(env) }, key, ct));
      } catch {
        throw codeError("decrypt_failed");
      }
    },
  };
}

// ------------------------------------------------------------------ pairing reveal (agent → browser, encrypted)

const REVEAL_ALG = "enki-pair-reveal-v1";

/** What the agent signs when it reveals its keys: binds them to this browser, both nonces and the code. */
export function revealTranscript({ agentEdPub, agentXPub, nA, browserEdPub, browserXPub, nB, code, name }) {
  return concat(enc.encode("enki-pair-v1 reveal"), lp(agentEdPub), lp(agentXPub), lp(nA), lp(browserEdPub), lp(browserXPub), lp(nB), lp(enc.encode(code)), lp(enc.encode(name)));
}

/** Encrypts the reveal to the browser's pairing X25519 key so the relay never sees the agent's name or keys. */
export async function sealReveal(plain, browserXPub) {
  const eph = await newX25519(true);
  const ephPub = await rawPublic(eph.publicKey);
  const key = await hkdfAesKey(await x25519(eph.privateKey, browserXPub), concat(ephPub, browserXPub), `${REVEAL_ALG} key`);
  const nonce = randomBytes(12);
  const head = { v: PAIR_VERSION, t: "reveal", eph: b64u(ephPub), nonce: b64u(nonce) };
  const aad = enc.encode([REVEAL_ALG, head.v, head.t, head.eph, head.nonce].join("\n"));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, key, enc.encode(JSON.stringify(plain))));
  return { ...head, ct: b64u(ct) };
}

export async function openReveal(msg, browserXPrivate, browserXPub) {
  const ephPub = unb64u(msg.eph, 32);
  const nonce = unb64u(msg.nonce, 12);
  const ct = unb64u(msg.ct);
  if (ct.length > 4096) throw codeError("too_large");
  const key = await hkdfAesKey(await x25519(browserXPrivate, ephPub), concat(ephPub, browserXPub), `${REVEAL_ALG} key`);
  const aad = enc.encode([REVEAL_ALG, msg.v, msg.t, msg.eph, msg.nonce].join("\n"));
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await subtle().decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, key, ct)));
  } catch {
    throw codeError("decrypt_failed");
  }
}

// ------------------------------------------------------------------ relay request signatures (browser → relay)

export const RELAY_SKEW_MS = 5 * 60_000;
const relayBytes = (method, mailbox, time) => enc.encode(["enki-relay-v1", method.toUpperCase(), mailbox, String(time)].join("\n"));

/** Headers for GET/DELETE on a pairing's mailbox: only the holder of the browser's Ed25519 key can drain it. */
export async function signRelayRequest({ method, mailbox, edPrivate, edPub, now = Date.now() }) {
  return {
    "Enki-Key": b64u(edPub),
    "Enki-Time": String(now),
    "Enki-Sig": b64u(await sign(edPrivate, relayBytes(method, mailbox, now))),
  };
}

/** Relay side. True when the headers prove the request comes from the mailbox's own key. */
export async function verifyRelayRequest({ method, mailbox, headers, now = Date.now() }) {
  try {
    const get = (k) => (typeof headers.get === "function" ? headers.get(k) : headers[k] ?? headers[k.toLowerCase()]);
    const key = unb64u(get("Enki-Key") ?? "", 32);
    const time = Number(get("Enki-Time"));
    const sig = unb64u(get("Enki-Sig") ?? "", 64);
    if (!Number.isSafeInteger(time) || Math.abs(now - time) > RELAY_SKEW_MS) return false;
    if ((await mailboxIdFor(key)) !== mailbox) return false;
    return await verify(key, sig, relayBytes(method, mailbox, time));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ agent credential (what pairing leaves on the agent side)

const CREDENTIAL_PREFIX = "enki-agent-v1:";

/**
 * Everything the agent needs to send, as one secret string (ENKI_AGENT_KEY / ENKI_AGENT_KEY_FILE).
 * Contains the agent's private keys: keep it in a secret store or a 0600 file, never in a chat or
 * the repository.
 */
export function encodeCredential({ relay, mailbox, name, browserXPub, agentEdPkcs8, agentXPkcs8, agentEdPub, agentXPub }) {
  const json = JSON.stringify({ v: 1, relay, mailbox, name, bx: b64u(browserXPub), ed: b64u(agentEdPkcs8), x: b64u(agentXPkcs8), edp: b64u(agentEdPub), xp: b64u(agentXPub) });
  return CREDENTIAL_PREFIX + b64u(enc.encode(json));
}

export function decodeCredential(text) {
  if (typeof text !== "string" || !text.trim().startsWith(CREDENTIAL_PREFIX)) throw new Error("not an Enki agent key (expected enki-agent-v1:…)");
  let c;
  try {
    c = JSON.parse(new TextDecoder().decode(unb64u(text.trim().slice(CREDENTIAL_PREFIX.length))));
  } catch {
    throw new Error("the Enki agent key is damaged");
  }
  if (c?.v !== 1 || typeof c.relay !== "string" || !MAILBOX_ID.test(c.mailbox ?? "")) throw new Error("the Enki agent key is damaged");
  return {
    relay: c.relay, mailbox: c.mailbox, name: c.name,
    browserXPub: unb64u(c.bx, 32), agentEdPkcs8: unb64u(c.ed), agentXPkcs8: unb64u(c.x), agentEdPub: unb64u(c.edp, 32), agentXPub: unb64u(c.xp, 32),
  };
}

/** A Sealer from a credential string (imports the keys once, non-extractable). */
export async function sealerFromCredential(text) {
  const c = decodeCredential(text);
  const agent = { edPrivate: await importEdPrivate(c.agentEdPkcs8), xPrivate: await importXPrivate(c.agentXPkcs8), edPub: c.agentEdPub, xPub: c.agentXPub };
  return { credential: { relay: c.relay, mailbox: c.mailbox, name: c.name }, sealer: createSealer({ mailbox: c.mailbox, agent, browser: { xPub: c.browserXPub } }) };
}
