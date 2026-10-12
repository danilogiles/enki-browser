// Removes tracking parameters from the addresses of pages you open (issue #17): ?utm_source=…,
// ?fbclid=… and the like tell the site, and whoever it shares them with, where the click came
// from. One declarativeNetRequest rule: Chromium rewrites the address before the request leaves,
// on top-level pages only (main_frame), and keeps every other parameter and the #fragment.
//
// An explicit list, on purpose: no utm_* wildcard and nothing generic such as ref or id, which
// sites also use for what the page shows. On a site with Shields down nothing is removed. Nothing
// is stored or logged about the pages this touches.
import { DOWN, downList, inIncognito, setDown, storedDownList } from "./sites.js";

export const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid",
  "igshid", "mc_eid", "_hsenc", "_hsmi", "li_fat_id",
];
export const STRIP_RULE = 2; // 1 is the phishing block (background.js)

export function stripRule(down = []) {
  return {
    id: STRIP_RULE,
    priority: 1,
    action: { type: "redirect", redirect: { transform: { queryTransform: { removeParams: TRACKING_PARAMS } } } },
    // Chromium does not redirect when the rewritten address is the same, so pages without these
    // parameters are untouched. excludedRequestDomains covers the site's subdomains too.
    condition: { resourceTypes: ["main_frame"], ...(down.length ? { excludedRequestDomains: down } : {}) },
  };
}

export async function applyStripRule() {
  const down = await downList();
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [STRIP_RULE], addRules: [stripRule(down)] });
}

// Made whenever the worker starts (onInstalled/onStartup are unreliable for extensions loaded from
// the command line; see menu.js), and again when the panel turns Shields up or down for a site.
const applying = () => void applyStripRule().catch((e) => console.warn(`[shield] tracking parameters: ${e.message}`));
applying();
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[DOWN]) applying(); });
// In Incognito the panel cannot keep the list itself (it closes) and nothing is written to
// storage, so it hands the change to this worker, which keeps it in memory (sites.js).
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.what !== "enki-shield:set-down" || sender.id !== chrome.runtime.id || typeof msg.host !== "string") return;
  setDown(msg.host, !!msg.down, { incognito: true }).then(applyStripRule).then(() => reply(true), () => reply(false));
  return true;
});
// For test/shield-params.mjs, which drives the worker.
globalThis.enkiShieldParams = { applyStripRule, downList, inIncognito, setDown, storedDownList, TRACKING_PARAMS };
