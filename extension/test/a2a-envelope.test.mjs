// Receive tabs (0.9): packet framing shared by the extension and mcp/. The crypto is a stub
// (DEV-ONLY passthrough) until Blink's envelope format lands; these tests pin the guarantees that
// do not depend on it (threat model §2: size cap before decrypt, fixed size, replay, age).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createBundleValidator, limitsFromSchema } from "../src/lib/a2a/validate-bundle.js";
import {
  DEV_PASSTHROUGH_ALG, devPassthroughOpener, devPassthroughSealer, fromBase64, newNonce, openEnvelope, padFrame, sealBundle,
  toBase64, toWireBundle, unpadFrame,
} from "../src/lib/a2a/envelope.js";

const schema = JSON.parse(readFileSync(new URL("../../protocol/deliver_tabs.schema.json", import.meta.url), "utf8"));
const validate = createBundleValidator(schema);
const limits = limitsFromSchema(schema);
const NOW = Date.UTC(2026, 9, 8, 15, 30);
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
const seal = (bundle, opts = {}) => sealBundle(bundle, { sealer: devPassthroughSealer, limits, now: NOW, ...opts });
const open = (wire, opts = {}) => openEnvelope(wire, {
  opener: devPassthroughOpener, validate, limits, seenNonce: () => false, now: NOW, allowDevPassthrough: true, ...opts,
});

test("a sealed bundle opens to the same bundle", async () => {
  const b = small();
  const { wire, nonce, ts } = await seal(b);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromBase64(JSON.parse(wire).body).subarray(4).filter((x) => x))).bundle, toWireBundle(b));
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
  assert.equal(fromBase64(a.envelope.body).length, limits.paddedFrameBytes);
});

test("any bundle the validator accepts fits the padded frame", () => {
  // Worst case: a bundle of exactly maxBundleBytes, plus the frame fields with the longest ts.
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
  const spy = { alg: DEV_PASSTHROUGH_ALG, async open() { opened = true; return new Uint8Array(); } };
  const r = await open("x".repeat(limits.maxEnvelopeBytes + 1), { opener: spy });
  assert.deepEqual(r, { ok: false, reason: "too_large" });
  assert.equal(opened, false);
  const bytes = new Uint8Array(limits.maxEnvelopeBytes + 1);
  assert.equal((await open(bytes, { opener: spy })).reason, "too_large");
  assert.equal(opened, false);
});

test("threat model: a bad or unpaired signature is rejected and yields no bundle", async () => {
  const { wire } = await seal(small());
  const unpaired = { alg: DEV_PASSTHROUGH_ALG, async open() { throw new Error("signature does not verify against any paired key"); } };
  const r = await open(wire, { opener: unpaired });
  assert.deepEqual(r, { ok: false, reason: "bad_signature_or_frame" });
  const otherAlg = { alg: "x25519-ed25519-v1", async open() { throw new Error("unreachable"); } };
  assert.equal((await open(wire, { opener: otherAlg })).reason, "wrong_alg");
});

test("threat model: a replayed packet is rejected", async () => {
  const { wire } = await seal(small());
  const seen = new Set();
  const first = await open(wire, { seenNonce: (n) => seen.has(n) });
  assert.equal(first.ok, true);
  seen.add(first.nonce); // the caller records the nonce once the packet is accepted
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

test("the DEV-ONLY passthrough is refused unless explicitly allowed", async () => {
  const { wire } = await seal(small());
  assert.deepEqual(await open(wire, { allowDevPassthrough: false }), { ok: false, reason: "dev_passthrough_refused" });
  assert.equal(JSON.parse(wire).alg, "dev-passthrough-INSECURE");
});

test("the receiver validates the bundle again: a sender that skips validation gets nothing through", async () => {
  const evil = { title: "ok", links: [{ url: "javascript:alert(1)" }] };
  const { wire } = await sealBundle(evil, { sealer: devPassthroughSealer, limits, now: NOW });
  const r = await open(wire);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid_bundle");
  // Fields only the receiver computes (host, idn) are not accepted from the sender either.
  const forged = { v: 1, nonce: newNonce(), ts: NOW, bundle: { title: "t", links: [{ url: "https://xn--l-7sba6dbr.com/", host: "paypal.com", idn: false }] } };
  const env = await devPassthroughSealer.seal(padFrame(forged, limits));
  const f = await open(JSON.stringify(env));
  assert.equal(f.ok, false);
  assert.deepEqual(f.errors.map((e) => e.code), ["unknown_field", "unknown_field"]);
});

test("malformed envelopes and frames are rejected without throwing", async () => {
  const good = JSON.parse((await seal(small())).wire);
  const frameBytes = fromBase64(good.body);
  const badPadding = frameBytes.slice(); badPadding[badPadding.length - 1] = 1;
  const badLength = frameBytes.slice(); new DataView(badLength.buffer).setUint32(0, 0xffffffff);
  const cases = [
    "not json", "null", "[]", JSON.stringify({ ...good, v: 2 }), JSON.stringify({ ...good, body: 5 }),
    JSON.stringify({ ...good, body: toBase64(frameBytes.subarray(1)) }),
    JSON.stringify({ ...good, body: toBase64(badPadding) }),
    JSON.stringify({ ...good, body: toBase64(badLength) }),
    JSON.stringify({ ...good, body: toBase64(padFrame({ v: 1, nonce: "short", ts: NOW, bundle: small() }, limits)) }),
    JSON.stringify({ ...good, body: toBase64(padFrame({ v: 1, nonce: newNonce(), ts: "now", bundle: small() }, limits)) }),
  ];
  for (const wire of cases) {
    const r = await open(wire);
    assert.equal(r.ok, false, wire.slice(0, 60));
  }
  assert.throws(() => unpadFrame(new Uint8Array(10), limits));
});
