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

// Incognito (manifest "incognito": "split" runs a second Shield there). Nothing that names a site
// may reach chrome.storage from it: its per-site switches and forget list live in that worker's
// memory only and vanish with the last private window. Pages ask the worker.
export const INCOGNITO = chrome.extension?.inIncognitoContext === true;
const IN_PAGE = typeof document !== "undefined";
const priv = { sites: null, forget: null };
const privateCall = (op, arg) => chrome.runtime.sendMessage({ type: "shields:private", op, arg });

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
  if (!INCOGNITO && raw !== undefined && !isSealed(raw)) await chrome.storage.local.set({ [key]: await seal(value) });
  return value;
}

export async function sites() {
  if (INCOGNITO) {
    if (IN_PAGE) return privateCall("sites");
    return (priv.sites ??= structuredClone(await readSealed(SITES, {})));
  }
  return readSealed(SITES, {});
}

export async function setSite(host, change) {
  if (INCOGNITO && IN_PAGE) return privateCall("setSite", [host, change]);
  const all = await sites();
  const next = { ...(all[host] ?? {}), ...change };
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  if (Object.keys(next).length) all[host] = next; else delete all[host];
  if (INCOGNITO) return applySites(all);
  await chrome.storage.local.set({ [SITES]: await seal(all) });
  await applySites(all);
}

export async function applySites(all) {
  if (INCOGNITO) {
    const scope = "incognito_session_only";
    await chrome.contentSettings.javascript.clear({ scope });
    await chrome.contentSettings.cookies.clear({ scope });
    for (const [host, s] of Object.entries(all)) {
      if (s.scripts === "block") await chrome.contentSettings.javascript.set({ primaryPattern: pattern(host), setting: "block", scope });
      if (s.cookies === "block") await chrome.contentSettings.cookies.set({ primaryPattern: pattern(host), setting: "block", scope });
    }
    return;
  }
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
  if (INCOGNITO) {
    if (IN_PAGE) return privateCall("forget");
    return (priv.forget ??= [...(await readSealed(FORGET, []))]);
  }
  return readSealed(FORGET, []);
}

export async function setForget(host, on) {
  if (INCOGNITO && IN_PAGE) return privateCall("setForget", [host, on]);
  const list = (await forgetList()).filter((h) => h !== host);
  if (on) list.push(host);
  if (INCOGNITO) { priv.forget = list; return; }
  await chrome.storage.local.set({ [FORGET]: await seal(list) });
}

if (INCOGNITO && !IN_PAGE) {
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg?.type !== "shields:private" || sender.id !== chrome.runtime.id) return false;
    const ops = { sites, forget: forgetList, setSite: (a) => setSite(...a), setForget: (a) => setForget(...a) };
    if (!ops[msg.op]) return false;
    Promise.resolve(ops[msg.op](msg.arg)).then((v) => reply(v ?? null), () => reply(null));
    return true;
  });
}
