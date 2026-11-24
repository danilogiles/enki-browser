// #114 product lock: Burn, Shred and burn-on-close also wipe Enki's "Always allow" sites.
// shield/burn.js against a mocked chrome (no browser needed): each wipe sends Enki exactly one
// {type:"enki:privacyWipe", scope} to Enki's id, after the website data is gone; Enki missing
// does not break Burn. Post-0.8.15 (Ink 0.8.15-burn-optional): saved passwords are deleted only
// when that one Burn's message carries passwords: true; burn-on-close and Shred never.
//
//   node test/burn-wipe-unit.mjs
import assert from "node:assert/strict";

const log = [];
let enkiReply = { ok: true };
let autoBurn = false;
const sets = [];
let onMessage = null;
globalThis.chrome = {
  runtime: {
    id: "shield",
    onMessage: { addListener(fn) { onMessage = fn; } },
    sendMessage: async (id, msg) => { log.push(["send", id, msg]); if (enkiReply instanceof Error) throw enkiReply; return enkiReply; },
  },
  windows: { getLastFocused: async () => ({ id: 1 }) },
  tabs: {
    create: async () => ({ id: 99 }),
    query: async () => [{ id: 1, url: "https://www.reddit.com/r/x" }, { id: 2, url: "https://example.org/" }, { id: 99, url: "chrome://newtab/" }],
    remove: async () => {},
  },
  browsingData: { remove: async (o, set) => { sets.push(set); log.push(["browsingData", o.origins ? "site" : "all"]); } },
  storage: {
    session: { get: async () => ({}), set: async () => {} },
    local: { get: async (k) => ({ [k]: autoBurn }) },
  },
};

const { burnAll, shredSite, wipeEnkiAllowedSites } = await import("../shield/burn.js");
const { ENKI_ID } = await import("../shield/omnibox.js");
await new Promise((r) => setTimeout(r, 20)); // the startup check (auto-burn off) settles
let n = 0;
const check = async (name, fn) => { log.length = 0; sets.length = 0; await fn(); n++; console.log("PASS", name); };

await check("Burn wipes website data, then asks Enki to wipe Allowed sites", async () => {
  await burnAll();
  assert.deepEqual(log, [["browsingData", "all"], ["send", ENKI_ID, { type: "enki:privacyWipe", scope: "burn" }]]);
});
await check("Shred wipes the site's data, then asks Enki to wipe Allowed sites", async () => {
  await shredSite("www.reddit.com");
  assert.deepEqual(log, [["browsingData", "site"], ["send", ENKI_ID, { type: "enki:privacyWipe", scope: "shred" }]]);
});
await check("Enki missing or disabled: Burn still finishes", async () => {
  enkiReply = new Error("Could not establish connection. Receiving end does not exist.");
  const res = await burnAll();
  assert.equal(typeof res.closed, "number");
  assert.equal(await wipeEnkiAllowedSites("burn"), false);
  enkiReply = { ok: false, error: "forbidden" };
  assert.equal(await wipeEnkiAllowedSites("burn", [0, 1]), false);
  assert.equal(log.filter((e) => e[0] === "send").length, 4, "retries only as many times as asked");
  enkiReply = { ok: true };
  assert.equal(await wipeEnkiAllowedSites("auto-burn", [0, 1]), true);
});

await check("Burn keeps saved passwords by default", async () => {
  const res = await burnAll();
  assert.equal(sets.length, 1);
  assert.equal(sets[0].passwords, undefined, "passwords not in the default wipe");
  assert.equal(sets[0].history, true);
  assert.equal(res.passwords, false);
});
await check("Burn deletes saved passwords only when this burn moved them", async () => {
  const res = await burnAll({ passwords: true });
  assert.equal(sets[0].passwords, true);
  assert.equal(sets[0].history, true, "the rest of the wipe is unchanged");
  assert.equal(res.passwords, true);
  assert.deepEqual(log.at(-1), ["send", ENKI_ID, { type: "enki:privacyWipe", scope: "burn" }]);
});
await check("Burn message: passwords only for the exact boolean true", async () => {
  const send = (msg, id = "shield") => new Promise((r) => { const async = onMessage(msg, { id }, r); if (!async) r("ignored"); });
  for (const [pw, want] of [[undefined, undefined], [false, undefined], ["true", undefined], [1, undefined], [{}, undefined], [true, true]]) {
    sets.length = 0;
    const res = await send({ type: "shields:burn", passwords: pw });
    assert.equal(sets.length, 1, `one wipe for passwords=${JSON.stringify(pw)}`);
    assert.equal(sets[0].passwords, want, `passwords=${JSON.stringify(pw)}`);
    assert.equal(res.passwords, want === true);
  }
  sets.length = 0;
  assert.equal(await send({ type: "shields:burn", passwords: true }, "someone-else"), "ignored", "other senders cannot burn");
  assert.equal(sets.length, 0);
});
await check("Shred never deletes saved passwords", async () => {
  await shredSite("www.reddit.com");
  assert.equal(sets.length, 1);
  assert.equal(sets[0].passwords, undefined);
});
await check("Every Burn opens fresh: a passwords burn is not remembered", async () => {
  await burnAll({ passwords: true });
  sets.length = 0;
  await burnAll();
  assert.equal(sets[0].passwords, undefined);
});

console.log(`${n}/${n} checks passed`);
