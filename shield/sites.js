// Per-site switches the Shields panel and its settings page share.
//
// Scripts and cookies use Chromium's content settings. That API can only clear every setting
// an extension made, not one, so the wanted state lives here (`shields:sites`) and is written
// back whole after each change. Ads and trackers are uBlock Origin Lite's filtering mode for
// the site, reached through the small patch Enki Browser applies to it.

import { isSealed, seal, unseal } from "./secrets.js";

export const SITES = "shields:sites";   // { [host]: { scripts?: "block", cookies?: "block" } }
export const FORGET = "shields:forget"; // [host]
export const BADGE = "shields:badge";
export const AUTO_BURN = "shields:auto-burn";
export const DOWN = "shields:down";     // [host] with Shields down (mirrors uBlock's mode 0 for the site)

export const LEVELS = [
  { level: 1, label: "Basic", hint: "Only the most common ads and trackers; fewest site breakages." },
  { level: 2, label: "Standard", hint: "Ads, trackers and annoyances, without breaking sites (default)." },
  { level: 3, label: "Aggressive", hint: "Everything uBlock knows, including first-party trackers; may break some sites." },
];

let ids = null;
export async function blockerId() {
  ids ??= await fetch(chrome.runtime.getURL("ids.json")).then((r) => r.json()).catch(() => ({}));
  return ids.ublock;
}

/** Asks uBlock Origin Lite; undefined when it is missing or unpatched. */
export async function blocker(what, extra = {}) {
  const id = await blockerId();
  if (!id) return undefined;
  return chrome.runtime.sendMessage(id, { what, ...extra }).catch(() => undefined);
}

export const pattern = (host) => `*://${host}/*`;

// Both lists name sites the user visits: stored sealed (secrets.js), and sealed on first read if
// an earlier version left them readable.
async function readSealed(key, fallback) {
  const raw = (await chrome.storage.local.get(key))[key];
  const value = await unseal(raw, fallback);
  if (raw !== undefined && !isSealed(raw)) await chrome.storage.local.set({ [key]: await seal(value) });
  return value;
}

export async function sites() {
  return readSealed(SITES, {});
}

export async function setSite(host, change) {
  const all = await sites();
  const next = { ...(all[host] ?? {}), ...change };
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  if (Object.keys(next).length) all[host] = next; else delete all[host];
  await chrome.storage.local.set({ [SITES]: await seal(all) });
  await applySites(all);
}

export async function applySites(all) {
  await chrome.contentSettings.javascript.clear({});
  await chrome.contentSettings.cookies.clear({});
  // "Burn when the browser closes": every site's cookies last only for the session.
  if ((await chrome.storage.local.get(AUTO_BURN))[AUTO_BURN] === true) {
    await chrome.contentSettings.cookies.set({ primaryPattern: "<all_urls>", setting: "session_only" });
  }
  for (const [host, s] of Object.entries(all)) {
    if (s.scripts === "block") await chrome.contentSettings.javascript.set({ primaryPattern: pattern(host), setting: "block" });
    if (s.cookies === "block") await chrome.contentSettings.cookies.set({ primaryPattern: pattern(host), setting: "block" });
  }
}

export async function forgetList() {
  return readSealed(FORGET, []);
}

export async function setForget(host, on) {
  const list = (await forgetList()).filter((h) => h !== host);
  if (on) list.push(host);
  await chrome.storage.local.set({ [FORGET]: await seal(list) });
}

// Sites with Shields down, as the panel's main switch set them. uBlock keeps its own mode per
// site; this copy is for what Enki Shield itself does (removing tracking parameters, params.js),
// which must stop on the same sites. Sealed like the lists above: it names sites.
//
// A site turned down from an Incognito context (split Incognito, #70) names a private visit: it
// stays in this worker's memory only, never in storage.local, and is gone when the last private
// window closes, the same as the search rule. Read at call time so tests can simulate it.
export const inIncognito = () => chrome.extension?.inIncognitoContext === true;
const memoryDown = new Set();

export const storedDownList = () => readSealed(DOWN, []);
export async function downList() {
  return [...new Set([...(await storedDownList()), ...memoryDown])];
}

export async function setDown(host, down, { incognito = inIncognito() } = {}) {
  if (incognito) {
    if (down) memoryDown.add(host); else memoryDown.delete(host);
    return;
  }
  const list = (await storedDownList()).filter((h) => h !== host);
  if (down) list.push(host);
  await chrome.storage.local.set({ [DOWN]: await seal(list) });
}
