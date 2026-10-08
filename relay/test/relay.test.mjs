// The reference relay: routes, signed fetches, size cap, per-mailbox cap, expiry, delete on fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler, LIMITS } from "../src/handler.js";
import { createMemoryStore } from "../src/memory-store.js";
import { startRelay } from "../server.js";
import { mailboxIdFor, newEd25519, pairMailboxIds, rawPublic, signRelayRequest } from "../../extension/src/lib/a2a/crypto.js";

const T0 = Date.UTC(2026, 9, 8, 15, 30);
async function owner() {
  const ed = await newEd25519(false);
  const edPub = await rawPublic(ed.publicKey);
  return { edPrivate: ed.privateKey, edPub, mailbox: await mailboxIdFor(edPub) };
}
function setup() {
  let t = T0;
  const store = createMemoryStore();
  const handle = createHandler(store, { now: () => t });
  const req = (method, path, { body, headers = {} } = {}) => handle(new Request(`http://relay.test${path}`, { method, body, headers }));
  return { req, store, tick: (ms) => (t += ms), now: () => t };
}
const env = (to, extra = {}) => JSON.stringify({ v: 1, alg: "enki-tabs-v1", to, ct: "x", ...extra });

test("post, signed take (deleted on fetch), and nothing for the next take", async () => {
  const { req, now } = setup();
  const o = await owner();
  assert.equal((await req("POST", `/v1/mailbox/${o.mailbox}`, { body: env(o.mailbox) })).status, 202);
  assert.equal((await req("POST", `/v1/mailbox/${o.mailbox}`, { body: env(o.mailbox, { n: 2 }) })).status, 202);
  const headers = await signRelayRequest({ method: "GET", mailbox: o.mailbox, edPrivate: o.edPrivate, edPub: o.edPub, now: now() });
  const res = await req("GET", `/v1/mailbox/${o.mailbox}`, { headers });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("access-control-allow-origin"), null, "no CORS: only Enki (with host access) and server-side senders talk to it");
  const { envelopes } = await res.json();
  assert.equal(envelopes.length, 2);
  assert.equal(JSON.parse(envelopes[1]).n, 2);
  const again = await (await req("GET", `/v1/mailbox/${o.mailbox}`, { headers })).json();
  assert.deepEqual(again.envelopes, []);
});

test("only the mailbox's own key can read or delete it", async () => {
  const { req, now } = setup();
  const o = await owner();
  const other = await owner();
  await req("POST", `/v1/mailbox/${o.mailbox}`, { body: env(o.mailbox) });
  assert.equal((await req("GET", `/v1/mailbox/${o.mailbox}`)).status, 401);
  const wrongKey = await signRelayRequest({ method: "GET", mailbox: o.mailbox, edPrivate: other.edPrivate, edPub: other.edPub, now: now() });
  assert.equal((await req("GET", `/v1/mailbox/${o.mailbox}`, { headers: wrongKey })).status, 401);
  const forDelete = await signRelayRequest({ method: "DELETE", mailbox: o.mailbox, edPrivate: o.edPrivate, edPub: o.edPub, now: now() });
  assert.equal((await req("GET", `/v1/mailbox/${o.mailbox}`, { headers: forDelete })).status, 401, "a DELETE signature is not a GET signature");
  const stale = await signRelayRequest({ method: "GET", mailbox: o.mailbox, edPrivate: o.edPrivate, edPub: o.edPub, now: now() - 6 * 60_000 });
  assert.equal((await req("GET", `/v1/mailbox/${o.mailbox}`, { headers: stale })).status, 401);
  assert.equal((await req("DELETE", `/v1/mailbox/${o.mailbox}`, { headers: forDelete })).status, 204);
  const get = await signRelayRequest({ method: "GET", mailbox: o.mailbox, edPrivate: o.edPrivate, edPub: o.edPub, now: now() });
  assert.deepEqual((await (await req("GET", `/v1/mailbox/${o.mailbox}`, { headers: get })).json()).envelopes, []);
});

test("pairing-exchange mailboxes need no signature to read", async () => {
  const { req } = setup();
  const { browser } = await pairMailboxIds("ENKI-7K2M-9QXP");
  assert.equal((await req("POST", `/v1/mailbox/${browser}`, { body: JSON.stringify({ v: 1, t: "commit", c: "x" }) })).status, 202);
  const { envelopes } = await (await req("GET", `/v1/mailbox/${browser}`)).json();
  assert.equal(JSON.parse(envelopes[0]).t, "commit");
});

test("size cap, shape, misaddressed packets, unknown routes and ids", async () => {
  const { req } = setup();
  const o = await owner();
  const big = env(o.mailbox, { pad: "x".repeat(LIMITS.maxEnvelopeBytes) });
  assert.equal((await req("POST", `/v1/mailbox/${o.mailbox}`, { body: big })).status, 413);
  assert.equal((await req("POST", `/v1/mailbox/${o.mailbox}`, { body: "not json" })).status, 400);
  assert.equal((await req("POST", `/v1/mailbox/${o.mailbox}`, { body: "[1]" })).status, 400);
  assert.equal((await req("POST", `/v1/mailbox/${o.mailbox}`, { body: JSON.stringify({ v: 2 }) })).status, 400);
  assert.equal((await req("POST", `/v1/mailbox/${o.mailbox}`, { body: env("A".repeat(22)) })).status, 400);
  assert.equal((await req("POST", "/v1/mailbox/short", { body: env("short") })).status, 404);
  assert.equal((await req("POST", "/v1/other", { body: "{}" })).status, 404);
  assert.equal((await req("PUT", `/v1/mailbox/${o.mailbox}`, { body: "{}" })).status, 405);
  assert.equal((await req("GET", "/health")).status, 200);
});

test("at most 20 waiting envelopes per mailbox, and everything expires after 10 minutes", async () => {
  const { req, tick, now, store } = setup();
  const o = await owner();
  for (let i = 0; i < LIMITS.maxPerMailbox; i++) assert.equal((await req("POST", `/v1/mailbox/${o.mailbox}`, { body: env(o.mailbox) })).status, 202);
  assert.equal((await req("POST", `/v1/mailbox/${o.mailbox}`, { body: env(o.mailbox) })).status, 429);
  tick(LIMITS.ttlMs);
  const headers = await signRelayRequest({ method: "GET", mailbox: o.mailbox, edPrivate: o.edPrivate, edPub: o.edPub, now: now() });
  assert.deepEqual((await (await req("GET", `/v1/mailbox/${o.mailbox}`, { headers })).json()).envelopes, []);
  await req("POST", `/v1/mailbox/${o.mailbox}`, { body: env(o.mailbox) });
  store.sweep(now() + LIMITS.ttlMs + 1);
  assert.equal(store.size(), 0);
});

test("the Node server listens on loopback and serves the same handler", async () => {
  const relay = await startRelay({ port: 0 });
  try {
    assert.match(relay.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const o = await owner();
    const post = await fetch(`${relay.url}/v1/mailbox/${o.mailbox}`, { method: "POST", body: env(o.mailbox), headers: { "content-type": "application/json" } });
    assert.equal(post.status, 202);
    const headers = await signRelayRequest({ method: "GET", mailbox: o.mailbox, edPrivate: o.edPrivate, edPub: o.edPub });
    const got = await (await fetch(`${relay.url}/v1/mailbox/${o.mailbox}`, { headers })).json();
    assert.equal(got.envelopes.length, 1);
    const huge = await fetch(`${relay.url}/v1/mailbox/${o.mailbox}`, { method: "POST", body: "x".repeat(LIMITS.maxEnvelopeBytes + 1) });
    assert.equal(huge.status, 413);
  } finally {
    await relay.close();
  }
});
