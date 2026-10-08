// Receive tabs (0.9): pairing. Fingerprint test vectors (protocol/pairing-fingerprint.vectors.json,
// for the MCP side too), the commit-reveal exchange, and what a man in the middle would see.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  b64u, crockford, decodeCredential, mailboxIdFor, newEd25519, newPairCode, newX25519, normalizePairCode, pairCommitment,
  pairFingerprint, pairMailboxIds, PAIR_CODE, randomBytes, rawPublic, sealReveal, unhex, hex, MAILBOX_ID, PAIR_MAILBOX_ID,
} from "../src/lib/a2a/crypto.js";
import { agentAnswerOffer, agentStart, browserOffer, browserReadCommit, browserReadReveal, cleanAgentName, pairAgent } from "../src/lib/a2a/pairing.js";
import { startRelay } from "../../relay/server.js";

const vectors = JSON.parse(readFileSync(new URL("../../protocol/pairing-fingerprint.vectors.json", import.meta.url), "utf8"));

test("Crockford base32 vectors", () => {
  for (const v of vectors.crockford) assert.equal(crockford(unhex(v.bytes)), v.text);
});

test("fingerprint and commitment vectors (shared with the MCP side)", async () => {
  for (const c of vectors.cases) {
    const b = (k) => unhex(c[k]);
    const fp = await pairFingerprint({ agentEdPub: b("agentEdPub"), agentXPub: b("agentXPub"), nA: b("nA"), browserEdPub: b("browserEdPub"), browserXPub: b("browserXPub"), nB: b("nB"), code: c.code });
    assert.equal(fp, c.expected.fingerprint, c.name);
    assert.match(fp, /^[0-9A-HJKMNP-TV-Z]{4}( [0-9A-HJKMNP-TV-Z]{4}){3}$/, "complete: 16 characters in 4 groups, never truncated");
    assert.equal(hex(await pairCommitment(b("agentEdPub"), b("agentXPub"), b("nA"))), c.expected.commitment, c.name);
  }
  const base = vectors.cases.find((c) => c.name === "base");
  const otherNB = vectors.cases.find((c) => /nB/.test(c.name));
  assert.notEqual(base.expected.fingerprint, otherNB.expected.fingerprint, "a different nB changes the fingerprint");
});

test("pairing codes: 40 random bits, typed forgivingly", () => {
  const codes = new Set(Array.from({ length: 200 }, () => newPairCode()));
  assert.equal(codes.size, 200);
  for (const c of codes) assert.match(c, PAIR_CODE);
  assert.equal(normalizePairCode("enki 7k2m 9qxp"), "ENKI-7K2M-9QXP");
  assert.equal(normalizePairCode("7K2M-9QXP"), "ENKI-7K2M-9QXP");
  assert.equal(normalizePairCode("ENKI-7K2M-9QXO"), "ENKI-7K2M-9QX0");
  assert.equal(normalizePairCode("ENKI-IL00-0000"), "ENKI-1100-0000");
  assert.equal(normalizePairCode("ENKI-7K2M-9QX"), null);
  assert.equal(normalizePairCode("ENKI-7K2M-9QXU"), null, "U is not Crockford");
  assert.equal(normalizePairCode(42), null);
});

test("pairing mailbox ids come from the code; a pairing's mailbox from the browser key", async () => {
  const a = await pairMailboxIds("ENKI-7K2M-9QXP");
  assert.match(a.browser, PAIR_MAILBOX_ID);
  assert.notEqual(a.browser, a.agent);
  assert.notEqual(a.browser, (await pairMailboxIds("ENKI-7K2M-9QXR")).browser);
  assert.match(await mailboxIdFor(randomBytes(32)), MAILBOX_ID);
});

async function browserSide() {
  const ed = await newEd25519(false);
  const x = await newX25519(false);
  return { xPrivate: x.privateKey, edPub: await rawPublic(ed.publicKey), xPub: await rawPublic(x.publicKey), nB: randomBytes(32) };
}
const ctx = (b, code, commitment) => ({ browserXPrivate: b.xPrivate, browserEdPub: b.edPub, browserXPub: b.xPub, nB: b.nB, code, commitment });

test("both sides compute the same fingerprint, and the browser learns the agent's name and keys", async () => {
  const code = newPairCode();
  const b = await browserSide();
  const agent = await agentStart();
  const commitment = browserReadCommit(agent.commit);
  const answer = await agentAnswerOffer(agent, browserOffer({ browserEdPub: b.edPub, browserXPub: b.xPub, nB: b.nB }), { code, name: "Helm" });
  const seen = await browserReadReveal(answer.reveal, ctx(b, code, commitment));
  assert.equal(seen.fingerprint, answer.fingerprint);
  assert.equal(seen.name, "Helm");
  assert.deepEqual(seen.agentEdPub, agent.agentEdPub);
  assert.ok(!JSON.stringify(answer.reveal).includes("Helm"), "the relay never sees the agent's name");
  assert.equal(answer.mailbox, await mailboxIdFor(b.edPub));
});

test("a man in the middle who swaps the browser's keys gets a different fingerprint on each side", async () => {
  const code = newPairCode();
  const b = await browserSide();
  const mitm = await browserSide();
  const agent = await agentStart();
  const commitment = browserReadCommit(agent.commit);
  // The relay replaces Enki's offer with its own keys towards the agent…
  const toAgent = await agentAnswerOffer(agent, browserOffer({ browserEdPub: mitm.edPub, browserXPub: mitm.xPub, nB: mitm.nB }), { code, name: "Helm" });
  // …and can only re-encrypt a reveal with its own keys towards Enki, which breaks the commitment.
  const mine = await agentStart();
  const fake = await agentAnswerOffer(mine, browserOffer({ browserEdPub: b.edPub, browserXPub: b.xPub, nB: b.nB }), { code, name: "Helm" });
  await assert.rejects(browserReadReveal(fake.reveal, ctx(b, code, commitment)), { code: "commitment_mismatch" });
  // Committing to its own keys from the start gets through the protocol, but the user sees two different fingerprints.
  const seen = await browserReadReveal(fake.reveal, ctx(b, code, browserReadCommit(mine.commit)));
  assert.notEqual(seen.fingerprint, toAgent.fingerprint);
});

test("reveal tampering, a wrong code, a bad signature and bad names are refused", async () => {
  const code = newPairCode();
  const b = await browserSide();
  const agent = await agentStart();
  const commitment = browserReadCommit(agent.commit);
  const offer = browserOffer({ browserEdPub: b.edPub, browserXPub: b.xPub, nB: b.nB });
  const answer = await agentAnswerOffer(agent, offer, { code, name: "Helm" });
  await assert.rejects(browserReadReveal(answer.reveal, ctx(b, "ENKI-0000-0000", commitment)), { code: "bad_signature" });
  await assert.rejects(browserReadReveal({ ...answer.reveal, ct: answer.reveal.ct.slice(0, -4) + "AAAA" }, ctx(b, code, commitment)), { code: "decrypt_failed" });
  // A reveal whose signature is not over this exchange.
  const plain = { ed: b64u(agent.agentEdPub), x: b64u(agent.agentXPub), na: b64u(agent.nA), name: "Helm", sig: b64u(new Uint8Array(64)) };
  await assert.rejects(browserReadReveal(await sealReveal(plain, b.xPub), ctx(b, code, commitment)), { code: "bad_signature" });
  await assert.rejects(agentAnswerOffer(agent, offer, { code, name: "" }), { code: "bad_name" });
  await assert.rejects(agentAnswerOffer(agent, offer, { code, name: "x".repeat(41) }), { code: "bad_name" });
  assert.equal(cleanAgentName("He\u202Elm"), "Helm", "bidi overrides are stripped from names");
  assert.throws(() => browserReadCommit({ v: 1, t: "offer" }));
});

test("pairAgent runs the agent side over a real relay; the credential carries no browser secret", async () => {
  const relay = await startRelay({ port: 0 });
  try {
    const code = newPairCode();
    const boxes = await pairMailboxIds(code);
    const b = await browserSide();
    let shown;
    const agentDone = pairAgent({ relay: relay.url, code, name: "Helm", pollMs: 20, timeoutMs: 5000, confirm: (fp) => { shown = fp; return true; } });
    // The browser side, by hand: wait for the commit, answer, wait for the reveal.
    const take = async (id) => (await (await fetch(`${relay.url}/v1/mailbox/${id}`)).json()).envelopes.map((s) => JSON.parse(s));
    let msgs = [];
    while (!msgs.length) { msgs = await take(boxes.browser); await new Promise((r) => setTimeout(r, 10)); }
    const commitment = browserReadCommit(msgs[0]);
    await fetch(`${relay.url}/v1/mailbox/${boxes.agent}`, { method: "POST", body: JSON.stringify(browserOffer({ browserEdPub: b.edPub, browserXPub: b.xPub, nB: b.nB })) });
    msgs = [];
    while (!msgs.length) { msgs = await take(boxes.browser); await new Promise((r) => setTimeout(r, 10)); }
    const seen = await browserReadReveal(msgs[0], ctx(b, code, commitment));
    const done = await agentDone;
    assert.equal(done.fingerprint, seen.fingerprint);
    assert.equal(shown, seen.fingerprint);
    const c = decodeCredential(done.credential);
    assert.equal(c.relay, relay.url);
    assert.equal(c.mailbox, await mailboxIdFor(b.edPub));
    assert.deepEqual(c.browserXPub, b.xPub);
    await assert.rejects(pairAgent({ relay: relay.url, code, name: "Helm", pollMs: 20, timeoutMs: 100, confirm: () => true }), /did not answer in time/);
  } finally {
    await relay.close();
  }
});
