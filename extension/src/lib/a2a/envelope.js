/**
 * Packet framing for "Receive tabs" (Enki 0.9), shared by the MCP server (sending side) and the
 * extension (receiving side). Dependency-free ES module.
 *
 *   bundle ─► frame {v, nonce, ts, bundle} ─► padded to a fixed size ─► seal() ─► envelope
 *   envelope ─► size cap ─► open() ─► unpad ─► frame checks (age, replay) ─► validate bundle again
 *
 * The cryptography is in crypto.js (createSealer / createOpener; format in
 * docs/0.9-receber-abas.md, "Protocolo"). This layer only talks to a small interface:
 *
 *   Sealer: { alg: string, seal(paddedFrame: Uint8Array): Promise<Envelope> }
 *           encrypts the padded frame to Enki's key for that pairing and signs the result, so the
 *           frame's nonce and timestamp are inside the signed part.
 *   Opener: { alg: string, open(envelope: Envelope): Promise<Uint8Array> }
 *           verifies the signature against the paired agent's key, then decrypts; throws (with a
 *           `code`) on any failure: unknown sender, bad signature, wrong key, tampering.
 *   Envelope: { v: 1, alg: "enki-tabs-v1", to, from, eph, nonce, ct, sig }  (JSON on the wire)
 *
 * There is no plaintext or unsigned mode, not even for development (threat model, Cloak): an
 * envelope whose alg is not the opener's is refused before anything else is looked at.
 *
 * What this layer guarantees, on top of the crypto:
 * - fixed-size padding, so the relay cannot tell link count or summary length from the size;
 * - the wire size cap (16 KB) is checked before anything is parsed or decrypted;
 * - every frame has a random 128-bit nonce and a timestamp; the receiver rejects frames older than
 *   10 minutes, too far in the future, or with a nonce it has already seen;
 * - the receiver validates the bundle again: a sender's validation is never trusted.
 */

export const ENVELOPE_VERSION = 1;
export const FRAME_VERSION = 1;

/** 128 random bits, base64url without padding. */
export function newNonce(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return toBase64(random(16)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Frame bytes: 4-byte big-endian length, the frame's UTF-8 JSON, then zeros up to exactly
 * `limits.paddedFrameBytes`. Throws if the frame does not fit (the validator's maxBundleBytes is
 * set so that a valid bundle always fits).
 */
export function padFrame(frame, limits) {
  const json = new TextEncoder().encode(JSON.stringify(frame));
  const size = limits.paddedFrameBytes;
  if (json.length + 4 > size) throw new Error(`frame is ${json.length} bytes; the padded frame holds ${size - 4}`);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, json.length);
  out.set(json, 4);
  return out;
}

/** Inverse of padFrame; throws on a malformed frame. */
export function unpadFrame(bytes, limits) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== limits.paddedFrameBytes) throw new Error("frame has the wrong size");
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (len > bytes.length - 4) throw new Error("frame length is out of range");
  for (let i = 4 + len; i < bytes.length; i++) if (bytes[i] !== 0) throw new Error("frame padding is not zero");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(4, 4 + len)));
}

/**
 * The bundle as it travels: the schema's shape only. `host` and `idn` are dropped because the
 * receiver computes them itself from the URL; it never takes them from the sender.
 */
export function toWireBundle(bundle) {
  const out = { title: bundle.title };
  if (bundle.summary !== undefined) out.summary = bundle.summary;
  out.links = bundle.links.map((l) => (l.label !== undefined ? { url: l.url, label: l.label } : { url: l.url }));
  return out;
}

/**
 * Sending side. `bundle` must already be the validator's output.
 * Returns { envelope, wire, nonce, ts }: `wire` is the exact JSON string to POST.
 */
export async function sealBundle(bundle, { sealer, limits, now = Date.now(), nonce = newNonce() }) {
  const frame = { v: FRAME_VERSION, nonce, ts: now, bundle: toWireBundle(bundle) };
  const envelope = await sealer.seal(padFrame(frame, limits));
  const wire = JSON.stringify(envelope);
  const bytes = new TextEncoder().encode(wire).length;
  if (bytes > limits.maxEnvelopeBytes) throw new Error(`envelope is ${bytes} bytes; the limit is ${limits.maxEnvelopeBytes}`);
  return { envelope, wire, nonce, ts: now };
}

/**
 * Receiving side. Never throws; returns { ok: true, bundle, nonce, ts, warnings } or
 * { ok: false, reason }. Nothing about a rejected packet should be shown or opened.
 *
 * @param wire     the envelope as received (string or bytes)
 * @param opts.opener            the paired agent's opener (verifies + decrypts)
 * @param opts.validate          createBundleValidator(schema)
 * @param opts.limits            limitsFromSchema(schema)
 * @param opts.seenNonce         (nonce) => boolean, true if this nonce was already accepted
 * @param opts.now               current time in ms
 * The caller records the nonce (for at least maxPacketAgeSeconds) only after ok: true.
 */
export async function openEnvelope(wire, { opener, validate, limits, seenNonce, now = Date.now() }) {
  const size = typeof wire === "string" ? new TextEncoder().encode(wire).length : wire?.byteLength;
  if (typeof size !== "number") return reject("not_bytes");
  // Before parsing or decrypting anything (threat model §2).
  if (size > limits.maxEnvelopeBytes) return reject("too_large");
  let envelope;
  try {
    envelope = JSON.parse(typeof wire === "string" ? wire : new TextDecoder("utf-8", { fatal: true }).decode(wire));
  } catch {
    return reject("malformed");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || envelope.v !== ENVELOPE_VERSION || typeof envelope.alg !== "string") {
    return reject("malformed");
  }
  // Plaintext, unsigned or unknown formats stop here, before the opener sees them.
  if (envelope.alg !== opener.alg) return reject("wrong_alg");

  let bytes;
  try {
    bytes = await opener.open(envelope);
  } catch (e) {
    // The opener names what failed (unknown_sender, bad_signature, decrypt_failed…).
    return reject(typeof e?.code === "string" ? e.code : "bad_signature_or_frame");
  }
  let frame;
  try {
    frame = unpadFrame(bytes, limits);
  } catch {
    return reject("bad_frame");
  }
  if (!frame || frame.v !== FRAME_VERSION || typeof frame.nonce !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(frame.nonce) || !Number.isSafeInteger(frame.ts)) {
    return reject("malformed_frame");
  }
  if (now - frame.ts > limits.maxPacketAgeSeconds * 1000) return reject("expired");
  if (frame.ts - now > limits.maxClockSkewSeconds * 1000) return reject("from_the_future");
  if (seenNonce(frame.nonce)) return reject("replay");

  const result = validate(frame.bundle);
  if (!result.ok) return reject("invalid_bundle", result.errors);
  return { ok: true, bundle: result.bundle, nonce: frame.nonce, ts: frame.ts, warnings: result.warnings };
}

function reject(reason, errors) {
  return errors ? { ok: false, reason, errors } : { ok: false, reason };
}

export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
