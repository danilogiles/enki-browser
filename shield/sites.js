// Per-site switches the Shields panel and its settings page share.
//
// Scripts and cookies use Chromium's content settings. That API can only clear every setting
// an extension made, not one, so the wanted state lives here (`shields:sites`) and is written
// back whole after each change. Ads and trackers are uBlock Origin Lite's filtering mode for
// the site, reached through the small patch Enki Browser applies to it.

export const SITES = "shields:sites";   // { [host]: { scripts?: "block", cookies?: "block" } }
export const FORGET = "shields:forget"; // [host]
export const BADGE = "shields:badge";

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

export async function sites() {
  return (await chrome.storage.local.get(SITES))[SITES] ?? {};
}

export async function setSite(host, change) {
  const all = await sites();
  const next = { ...(all[host] ?? {}), ...change };
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  if (Object.keys(next).length) all[host] = next; else delete all[host];
  await chrome.storage.local.set({ [SITES]: all });
  await applySites(all);
}

export async function applySites(all) {
  await chrome.contentSettings.javascript.clear({});
  await chrome.contentSettings.cookies.clear({});
  for (const [host, s] of Object.entries(all)) {
    if (s.scripts === "block") await chrome.contentSettings.javascript.set({ primaryPattern: pattern(host), setting: "block" });
    if (s.cookies === "block") await chrome.contentSettings.cookies.set({ primaryPattern: pattern(host), setting: "block" });
  }
}

export async function forgetList() {
  return (await chrome.storage.local.get(FORGET))[FORGET] ?? [];
}

export async function setForget(host, on) {
  const list = (await forgetList()).filter((h) => h !== host);
  if (on) list.push(host);
  await chrome.storage.local.set({ [FORGET]: list });
}
