// #114 product lock: Burn, Shred and burn-on-close also wipe Enki's "Always allow" sites.
// shield/burn.js against a mocked chrome (no browser needed): each wipe sends Enki exactly one
// {type:"enki:privacyWipe", scope} to Enki's id, after the website data is gone; Enki missing
// does not break Burn.
//
//   node test/burn-wipe-unit.mjs
import assert from "node:assert/strict";

const log = [];
let enkiReply = { ok: true };
let autoBurn = false;
globalThis.chrome = {
  runtime: {
    id: "shield",
    onMessage: { addListener() {} },
    sendMessage: async (id, msg) => { log.push(["send", id, msg]); if (enkiReply instanceof Error) throw enkiReply; return enkiReply; },
  },
  windows: { getLastFocused: async () => ({ id: 1 }) },
  tabs: {
    create: async () => ({ id: 99 }),
    query: async () => [{ id: 1, url: "https://www.reddit.com/r/x" }, { id: 2, url: "https://example.org/" }, { id: 99, url: "chrome://newtab/" }],
    remove: async () => {},
  },
  browsingData: { remove: async (o) => { log.push(["browsingData", o.origins ? "site" : "all"]); } },
  storage: {
    session: { get: async () => ({}), set: async () => {} },
    local: { get: async (k) => ({ [k]: autoBurn }) },
  },
};

const { burnAll, shredSite, wipeEnkiAllowedSites } = await import("../shield/burn.js");
const { ENKI_ID } = await import("../shield/omnibox.js");
await new Promise((r) => setTimeout(r, 20)); // the startup check (auto-burn off) settles
let n = 0;
const check = async (name, fn) => { log.length = 0; await fn(); n++; console.log("PASS", name); };

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

console.log(`${n}/${n} checks passed`);
