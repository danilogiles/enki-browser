// Unit checks for test/cookie-3p.mjs, the decision behind verify.mjs's third-party cookie check.
//
//   node test/cookie-3p-unit.mjs
import { judgeThirdPartyCookies as judge } from "./cookie-3p.mjs";

let failed = 0;
const expect = (name, got, want) => {
  const ok = got.ok === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${got.detail}`);
};
const blocked = { firstParty: true, thirdParty: false };
const sent = { firstParty: true, thirdParty: true };
const policy = (value) => ({ value, enforcement: "ENFORCED", controlledBy: "USER_POLICY" });

expect("Enki default, blocked on the wire", judge({ pref: { value: 1 }, profileValue: 1, network: blocked }), true);
expect("Enki default not written (no profile value yet), blocked", judge({ pref: { value: 1 }, profileValue: null, network: blocked }), true);
expect("registered default (incognito only) is a failure", judge({ pref: { value: 2 }, profileValue: null, network: sent }), false);
expect("allow is a failure", judge({ pref: { value: 0 }, profileValue: 0, network: sent }), false);
expect("pref says block but the cookie went out is a failure", judge({ pref: { value: 1 }, profileValue: 1, network: sent }), false);
expect("no first-party control cookie is a failure", judge({ pref: { value: 1 }, profileValue: 1, network: { firstParty: false, thirdParty: false } }), false);
expect("no network result is a failure", judge({ pref: { value: 1 }, profileValue: 1, network: null }), false);
expect("unreadable pref is a failure", judge({ pref: null, profileValue: 1, network: blocked }), false);
// The machine this was found on: /etc/chromium/policies/managed sets BlockThirdPartyCookies:false;
// the page shows Allow while the fresh profile has Enki's 1. It must fail, naming the policy.
const viaPolicy = judge({ pref: policy(0), profileValue: 1, network: sent });
expect("a policy that allows fails", viaPolicy, false);
expect("…and says it is a machine policy", { ok: /overridden by machine policy/.test(viaPolicy.detail), detail: viaPolicy.detail }, true);
expect("a policy that blocks still fails (Enki's default is not what is in effect)", judge({ pref: policy(1), profileValue: 1, network: blocked }), false);
expect("a recommended/extension-controlled value fails", judge({ pref: { value: 1, controlledBy: "EXTENSION" }, profileValue: 1, network: blocked }), false);
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
