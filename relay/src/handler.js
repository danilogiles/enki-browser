/**
 * Enki relay: store-and-forward of opaque envelopes per mailbox. A standard fetch handler, run by
 * Cloudflare Workers (worker.js) or Node (server.js) over a pluggable store.
 *
 *   POST   /v1/mailbox/{id}   anyone: leave one envelope (≤ 16 KB of JSON) for 10 minutes
 *   GET    /v1/mailbox/{id}   take every waiting envelope; they are deleted as they are returned
 *   DELETE /v1/mailbox/{id}   drop the mailbox (Enki does this when you unpair)
 *
 * Two kinds of mailbox:
 *   - a pairing's mailbox, id = 22 base64url characters derived from the browser's Ed25519 key.
 *     GET and DELETE must be signed with that key (Enki-Key / Enki-Time / Enki-Sig), so only that
 *     Enki can drain it;
 *   - a pairing-exchange mailbox, id = "p-" + 22 characters derived from the one-time code. It
 *     only ever carries public pairing messages (a commitment, public keys, and an encrypted
 *     reveal), so reading it needs no signature.
 *
 * Privacy: no logs, no accounts, no cookies, no analytics. The relay sees ciphertext of a fixed
 * size, the mailbox id, the time and the connecting IP (as any server does), and keeps nothing
 * after delivery or expiry. It never tells a sender whether an envelope was fetched.
 */
import { MAILBOX_ID, PAIR_MAILBOX_ID, verifyRelayRequest } from "../../extension/src/lib/a2a/crypto.js";

export const LIMITS = Object.freeze({
  maxEnvelopeBytes: 16384,
  ttlMs: 10 * 60_000,
  maxPerMailbox: 20,
});

const ROUTE = /^\/v1\/mailbox\/([A-Za-z0-9_-]{1,64})$/;
const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { ...HEADERS, ...(body === undefined ? {} : { "content-type": "application/json" }) } });

/** Reads at most `limit` bytes; null if the body is larger. */
async function readLimited(request, limit) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(all); } catch { return undefined; }
}

/**
 * store: { push(id, text, { now, expiresAt, maxPerMailbox }) → Promise<boolean>, take(id, now) → Promise<string[]>, clear(id) → Promise<void> }
 */
export function createHandler(store, { now = () => Date.now(), limits = LIMITS } = {}) {
  return async function handle(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return json(200, { ok: true });
    const m = ROUTE.exec(url.pathname);
    if (!m) return json(404, { error: "not_found" });
    const id = m[1];
    const pairing = PAIR_MAILBOX_ID.test(id);
    if (!pairing && !MAILBOX_ID.test(id)) return json(404, { error: "not_found" });

    if (request.method === "POST") {
      const text = await readLimited(request, limits.maxEnvelopeBytes);
      if (text === null) return json(413, { error: "too_large" });
      let parsed;
      try { parsed = JSON.parse(text ?? ""); } catch { return json(400, { error: "not_json" }); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.v !== 1) return json(400, { error: "not_an_envelope" });
      // A packet carries its mailbox; refuse one addressed elsewhere rather than misdeliver it.
      if (!pairing && parsed.to !== undefined && parsed.to !== id) return json(400, { error: "wrong_mailbox" });
      const t = now();
      const ok = await store.push(id, text, { now: t, expiresAt: t + limits.ttlMs, maxPerMailbox: limits.maxPerMailbox });
      return ok ? json(202) : json(429, { error: "mailbox_full" });
    }

    if (request.method === "GET" || request.method === "DELETE") {
      if (!pairing && !(await verifyRelayRequest({ method: request.method, mailbox: id, headers: request.headers, now: now() }))) {
        return json(401, { error: "unauthorized" });
      }
      if (request.method === "DELETE") { await store.clear(id); return json(204); }
      return json(200, { envelopes: await store.take(id, now()) });
    }

    return json(405, { error: "method_not_allowed" });
  };
}
