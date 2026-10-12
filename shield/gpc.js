// Global Privacy Control (issue #18): tells every site you do not want your data sold or shared,
// a signal some laws (California's CCPA, Colorado's) require sites to honor. Two halves, as the
// spec (https://w3c.github.io/gpc/) defines it:
//   - the Sec-GPC: 1 header on every request, set by one declarativeNetRequest rule;
//   - navigator.globalPrivacyControl === true, from gpc-page.js, a MAIN-world script that runs at
//     document_start in every frame.
// It is a signal, not a block, so it stays on where Shields are down. It reveals nothing about
// you beyond the choice itself, and nothing is stored or logged. One switch in Shields' settings,
// on by default.
export const GPC = "shields:gpc"; // local: false turns it off
export const GPC_RULE = 3;        // 1 is the phishing block (background.js)
const SCRIPT = "enki-gpc";

const ALL_TYPES = ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest",
  "ping", "csp_report", "media", "websocket", "webtransport", "webbundle", "other"];

export async function gpcOn() {
  return (await chrome.storage.local.get(GPC))[GPC] !== false;
}

export async function applyGpc(on) {
  on ??= await gpcOn();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [GPC_RULE],
    addRules: on ? [{
      id: GPC_RULE,
      // Above the allow rule for a phishing warning the user clicked through (priority 2): an
      // allow rule of higher priority would drop the header on that site.
      priority: 100,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "Sec-GPC", operation: "set", value: "1" }] },
      condition: { resourceTypes: ALL_TYPES },
    }] : [],
  });
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT] })).length > 0;
  if (on && !registered) {
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT, js: ["gpc-page.js"], matches: ["<all_urls>"], allFrames: true, matchOriginAsFallback: true,
      runAt: "document_start", world: "MAIN", persistAcrossSessions: true,
    }]);
  } else if (!on && registered) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT] });
  }
}

// Made whenever the worker starts (onInstalled/onStartup are unreliable for extensions loaded from
// the command line; see menu.js), and again when the switch changes.
let applying = Promise.resolve();
const apply = () => { applying = applying.then(() => applyGpc()).catch((e) => console.warn(`[shield] GPC: ${e.message}`)); return applying; };
void apply();
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[GPC]) void apply(); });
// For test/shield-gpc.mjs, which drives the worker.
globalThis.enkiShieldGpc = { applyGpc, ready: () => applying };
