// Receive tabs (0.9): packet framing + the real envelope crypto (crypto.js), shared by the
// extension and mcp/. Pins threat model §2: size cap before decrypt, fixed size, signature
// before decryption, replay and age, and no plaintext or unsigned mode at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newNonce, openEnvelope, padFrame, sealBundle, toBase64, unpadFrame } from "../src/lib/a2a/envelope.js";
import { b64u, createOpener, createSealer, TABS_ALG, unb64u } from "../src/lib/a2a/crypto.js";
import { limits, pairInProcess, validate } from "./a2a-fixtures.mjs";

const NOW = Date.UTC(2026, 9, 8, 15, 30);
const P = await pairInProcess();
const bundleOf = (input) => {
  const r = validate(input);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.bundle;
};
const small = () => bundleOf({ title: "Pneu de neve", links: [{ url: "https://example.com/a" }] });
const largest = () => bundleOf({
  title: "t".repeat(60), summary: "s".repeat(1500),
  links: Array.from({ length: 10 }, (_, i) => ({ url: `https://example.com/${i}/` + "a".repeat(600), label: "l".repeat(80) })),
});
const seal = (bundle, opts = {}) => sealBundle(bundle, { sealer: P.sealer, limits, now: NOW, ...opts });
const open = (wire, opts = {}) => openEnvelope(wire, { opener: P.opener, validate, limits, seenNonce: () => false, now: NOW, ...opts });

test("a sealed bundle opens to the same bundle, and the wire shows none of it", async () => {
  const b = small();
  const { wire, nonce, ts, envelope } = await seal(b);
  assert.deepEqual(Object.keys(envelope), ["v", "alg", "to", "from", "eph", "nonce", "ct", "sig"]);
  assert.equal(envelope.alg, TABS_ALG);
  assert.equal(envelope.to, P.mailbox);
  assert.ok(!wire.includes("Pneu") && !wire.includes("example.com"), "the relay sees ciphertext only");
  const r = await open(wire);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.bundle, b);
  assert.equal(r.nonce, nonce);
  assert.equal(r.ts, ts);
});

test("every envelope has the same size, whatever the bundle, and stays under the 16 KB cap", async () => {
  const a = await seal(small());
  const b = await seal(largest());
  assert.equal(a.wire.length, b.wire.length, "link count and summary length must not show in the size");
  assert.ok(new TextEncoder().encode(b.wire).length <= limits.maxEnvelopeBytes);
  assert.equal(unb64u(a.envelope.ct).length, limits.paddedFrameBytes + 16);
});

test("any bundle the validator accepts fits the padded frame", () => {
  const empty = JSON.stringify({ title: "x", summary: "", links: [] }).length;
  const bundle = { title: "x", summary: "s".repeat(limits.maxBundleBytes - empty), links: [] };
  assert.equal(new TextEncoder().encode(JSON.stringify(bundle)).length, limits.maxBundleBytes);
  assert.doesNotThrow(() => padFrame({ v: 1, nonce: newNonce(), ts: Number.MAX_SAFE_INTEGER, bundle }, limits));
  assert.throws(() => padFrame({ v: 1, nonce: newNonce(), ts: 0, bundle: { ...bundle, summary: "s".repeat(limits.paddedFrameBytes) } }, limits));
});

test("nonces are 128-bit, base64url, and unique", () => {
  const set = new Set(Array.from({ length: 1000 }, () => newNonce()));
  assert.equal(set.size, 1000);
  for (const n of set) assert.match(n, /^[A-Za-z0-9_-]{22}$/);
});

test("threat model: an envelope over the size cap is rejected before it is parsed or opened", async () => {
  let opened = false;
  const spy = { alg: TABS_ALG, async open() { opened = true; return new Uint8Array(); } };
  assert.deepEqual(await open("x".repeat(limits.maxEnvelopeBytes + 1), { opener: spy }), { ok: false, reason: "too_large" });
  assert.equal((await open(new Uint8Array(limits.maxEnvelopeBytes + 1), { opener: spy })).reason, "too_large");
  assert.equal(opened, false);
});

test("threat model: a packet from an unpaired agent, or with a bad signature, is rejected and nothing is decrypted", async () => {
  const { wire } = await seal(small());
  // Another agent, paired with another browser, cannot reach this one.
  const stranger = await pairInProcess({ name: "n8n" });
  const fromStranger = (await sealBundle(small(), { sealer: stranger.sealer, limits, now: NOW })).wire;
  assert.equal((await open(fromStranger)).reason, "wrong_mailbox");
  // Same mailbox, but signed by a key Enki never paired: unknown sender.
  const forged = createSealer({ mailbox: P.mailbox, agent: { edPrivate: stranger.agent.ed.privateKey, xPrivate: stranger.agent.x.privateKey, edPub: stranger.agent.agentEdPub, xPub: stranger.agent.agentXPub }, browser: { xPub: P.browser.xPub } });
  assert.equal((await open((await sealBundle(small(), { sealer: forged, limits, now: NOW })).wire)).reason, "unknown_sender");
  // The paired agent's id with a stranger's signature.
  const env = JSON.parse(wire);
  const other = JSON.parse(fromStranger);
  assert.equal((await open(JSON.stringify({ ...env, sig: other.sig }))).reason, "bad_signature");
  // Any change to the ciphertext or header breaks the signature.
  const ct = unb64u(env.ct); ct[100] ^= 1;
  assert.equal((await open(JSON.stringify({ ...env, ct: b64u(ct) }))).reason, "bad_signature");
  assert.equal((await open(JSON.stringify({ ...env, nonce: b64u(new Uint8Array(12)) }))).reason, "bad_signature");
});

test("threat model: plaintext or unsigned envelopes are never accepted (there is no dev mode)", async () => {
  const { envelope } = await seal(small());
  const frame = padFrame({ v: 1, nonce: newNonce(), ts: NOW, bundle: { title: "t", links: [{ url: "https://e.example/" }] } }, limits);
  const plaintext = [
    { v: 1, alg: "dev-passthrough-INSECURE", body: toBase64(frame) },
    { v: 1, alg: "none", body: toBase64(frame) },
    { v: 1, body: toBase64(frame) },
  ];
  for (const e of plaintext) assert.equal((await open(JSON.stringify(e))).ok, false, e.alg);
  const { sig: _sig, ...unsigned } = envelope;
  assert.equal((await open(JSON.stringify(unsigned))).reason, "malformed");
  assert.equal((await open(JSON.stringify({ ...envelope, sig: "" }))).reason, "malformed");
  assert.equal((await open(JSON.stringify({ ...envelope, sig: b64u(new Uint8Array(64)) }))).reason, "bad_signature");
  // Even an opener that would hand back plaintext is only reached for the real alg.
  const leaky = { alg: TABS_ALG, async open(e) { return Uint8Array.from(atob(e.body ?? ""), (c) => c.charCodeAt(0)); } };
  assert.equal((await open(JSON.stringify(plaintext[0]), { opener: leaky })).reason, "wrong_alg");
});

test("threat model: a replayed packet is rejected", async () => {
  const { wire } = await seal(small());
  const seen = new Set();
  const first = await open(wire, { seenNonce: (n) => seen.has(n) });
  assert.equal(first.ok, true);
  seen.add(first.nonce);
  assert.deepEqual(await open(wire, { seenNonce: (n) => seen.has(n) }), { ok: false, reason: "replay" });
});

test("threat model: a packet older than 10 minutes (or from the future) is rejected", async () => {
  const { wire } = await seal(small(), { now: NOW - 10 * 60_000 - 1 });
  assert.deepEqual(await open(wire), { ok: false, reason: "expired" });
  const edge = await seal(small(), { now: NOW - 10 * 60_000 });
  assert.equal((await open(edge.wire)).ok, true);
  const future = await seal(small(), { now: NOW + 3 * 60_000 });
  assert.deepEqual(await open(future.wire), { ok: false, reason: "from_the_future" });
});

test("the receiver validates the bundle again: a sender that skips validation gets nothing through", async () => {
  const evil = { title: "ok", links: [{ url: "javascript:alert(1)" }] };
  const r = await open((await sealBundle(evil, { sealer: P.sealer, limits, now: NOW })).wire);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid_bundle");
  const forged = { v: 1, nonce: newNonce(), ts: NOW, bundle: { title: "t", links: [{ url: "https://xn--l-7sba6dbr.com/", host: "paypal.com", idn: false }] } };
  const env = await P.sealer.seal(padFrame(forged, limits));
  const f = await open(JSON.stringify(env));
  assert.equal(f.ok, false);
  assert.deepEqual(f.errors.map((e) => e.code), ["unknown_field", "unknown_field"]);
});

test("malformed envelopes and frames are rejected without throwing", async () => {
  const good = JSON.parse((await seal(small())).wire);
  const frameOf = (bytes) => P.sealer.seal(bytes);
  const frameBytes = padFrame({ v: 1, nonce: newNonce(), ts: NOW, bundle: small() }, limits);
  const badPadding = frameBytes.slice(); badPadding[badPadding.length - 1] = 1;
  const badLength = frameBytes.slice(); new DataView(badLength.buffer).setUint32(0, 0xffffffff);
  const cases = [
    "not json", "null", "[]", JSON.stringify({ ...good, v: 2 }), JSON.stringify({ ...good, eph: 5 }), JSON.stringify({ ...good, extra: 1 }),
    JSON.stringify({ ...good, eph: good.eph + "A" }),
    JSON.stringify(await frameOf(badPadding)),
    JSON.stringify(await frameOf(badLength)),
    JSON.stringify(await frameOf(padFrame({ v: 1, nonce: "short", ts: NOW, bundle: small() }, limits))),
    JSON.stringify(await frameOf(padFrame({ v: 1, nonce: newNonce(), ts: "now", bundle: small() }, limits))),
  ];
  for (const wire of cases) assert.equal((await open(wire)).ok, false, wire.slice(0, 60));
  // A shorter frame changes the ciphertext size: refused before verification.
  assert.equal((await open(JSON.stringify(await frameOf(frameBytes.subarray(1))))).reason, "malformed");
  assert.throws(() => unpadFrame(new Uint8Array(10), limits));
});

test("an opener for one pairing never opens another pairing's packets", async () => {
  const other = await pairInProcess({ name: "n8n" });
  const wrongBrowser = createOpener({ mailbox: P.mailbox, browser: other.browser, agent: { edPub: P.seen.agentEdPub, xPub: P.seen.agentXPub } });
  const { wire } = await seal(small());
  assert.equal((await open(wire, { opener: wrongBrowser })).reason, "decrypt_failed");
});
