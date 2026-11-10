// Test copies (shield/testcopy.js): with test-copy.json, Shield never reaches a native host, never
// asks GitHub, and says "Test copy, updates off"; without it nothing changes. And a host refusal
// ({ unavailable: true }, launcher/NativeHost.cs) shows "Unavailable in this copy." on Restart.
//   node test/shield-testcopy.mjs
import { TEST_COPY, UNAVAILABLE, resetTestCopy, testCopy } from "../shield/testcopy.js";

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

let hostCalls = 0, netCalls = 0;
globalThis.chrome = {
  runtime: {
    getURL: (p) => `chrome-extension://shield/${p}`,
    sendNativeMessage: (host, msg, cb) => { hostCalls++; cb({ running: "0.8.16", ready: null, latest: null, updatesOff: false }); },
    lastError: undefined,
  },
};
globalThis.fetch = async (url) => {
  if (String(url).endsWith("ids.json")) return { ok: true, json: async () => ({ browser: "0.8.16" }) };
  if (String(url).endsWith("test-copy.json")) throw new TypeError("Failed to fetch"); // normal builds: no file
  netCalls++;
  return { ok: true, json: async () => ({ tag_name: "v0.8.16" }) };
};
const { check: checkUpdates, native, restartWithFallback, status } = await import("../shield/updates.js");

check("the label is the agreed text", TEST_COPY === "Test copy, updates off" && UNAVAILABLE === "Unavailable in this copy.");

// A normal build: no test-copy.json.
resetTestCopy();
check("normal build: not a test copy", (await testCopy()) === null);
const s = await status();
check("normal build: status asks the native host", hostCalls === 1 && s.updater === true && !s.testCopy);

// Malformed files never turn it on.
for (const [what, body] of [["testCopy false", { testCopy: false }], ["a string", "yes"], ["null", null]]) {
  resetTestCopy();
  check(`a test-copy.json with ${what} is not a test copy`, (await testCopy(async () => body)) === null);
}

// A test copy.
resetTestCopy();
check("test copy: recognised, with its label", (await testCopy(async () => ({ testCopy: true, label: "abc1234", token: "x" })))?.label === "abc1234");
hostCalls = 0; netCalls = 0;
const replies = await Promise.all(["check", "restart", "open-default-apps", "widevine-install", "widevine-remove", "status", "default-status", "widevine-status"].map((type) => native({ type })));
check("test copy: no request ever reaches a native host", hostCalls === 0 && replies.every((r) => r === null), `host calls ${hostCalls}`);
const st = await status(), ch = await checkUpdates();
check("test copy: status and check say testCopy, without the host or GitHub", st.testCopy === true && ch.testCopy === true && hostCalls === 0 && netCalls === 0 && st.running === "0.8.16");

// A refusal from the host renders as unavailable, not as a hang or a generic failure.
const els = { button: { disabled: false, textContent: "Restart to update" }, state: { textContent: "" }, help: { hidden: true, textContent: "" } };
const outcome = await restartWithFallback(els, async () => ({ unavailable: true, restarting: false, error: "unavailable in this copy" }), 10000, () => {});
check("host refusal: Restart shows Unavailable in this copy", outcome === "unavailable" && els.state.textContent === UNAVAILABLE && els.button.disabled === false && els.help.hidden === true);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
