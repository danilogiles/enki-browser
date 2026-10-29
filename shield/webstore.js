// "Install in Enki" on Chrome Web Store pages, the worker's half (the button is webstore-page.js;
// the design and words are Ink's, docs/WEBSTORE.md).
//
// ungoogled-chromium, which Enki Browser is built on, has no Web Store installs: the store's own
// button does nothing. Chromium still installs a .crx it downloads, with its own CRX3 signature
// check and its own permissions prompt, because Enki starts it with
// --extension-mime-request-handling=always-prompt-for-install (config/flags.txt). So Shield only
// opens Google's .crx address for the extension on the page, after a click; Chromium does the
// rest, unchanged. Nothing is installed until the user clicks "Add extension" in that prompt.
//
// Privacy (PRIVACY.md, rules/webstore.json):
//  - Google is contacted only after that click, and by the optional update check below. The id is
//    read from the address of the store page the click came from, as Chromium reports it to this
//    worker (never from the page's content), and the address to open is built here. The card
//    sends the id it showed the user; if that is not the id in the address, nothing is opened.
//  - rules/webstore.json removes Cookie, Referer and X-Client-Data from every request to
//    clients2.google.com and clients2.googleusercontent.com, and Set-Cookie from their answers, so
//    the Google cookies a store visit leaves (NID…) do not ride along. No Google account is used.
//
// No `management` permission: Shield cannot see what is installed, so it keeps its own record of
// what was installed through the button: { id, name, version }. The version is read from the file
// name Google's server redirects the download to (…/<ID>_1_0_102_0.crx), as the download starts.
// That record drifts: an extension removed in chrome://extensions, or an install cancelled at
// Chromium's prompt, stays in it (and, with update checks on, its id and recorded version are
// still sent) until the user forgets it in Shields' settings.
//
// Optional update check (Shields' settings, off by default): a 24-hour alarm that exists only
// while the switch is on (a run missed while the browser was closed comes on the next start).
// One request to clients2.google.com with prodversion, acceptformat and one x=id…&v…&uc per
// recorded extension, nothing else. A newer version shows a notice in the Shields panel and in
// Shields' settings; "Update" opens the same .crx address and Chromium's prompt.
//
// The .crx Chromium downloads goes through the Downloads folder; after "Add extension" Chromium
// removes it, after "Cancel" it stays. Removing it would take the `downloads` permission, which
// Shield does not have and does not add (docs/WEBSTORE.md).
import { CRX_HOSTS, STORE_ORIGIN, UPDATE_URL, compareVersions, crxUrl, idFromCrxUrl, installId, isId, parseUpdateResponse, updateCheckUrl, versionFromCrxUrl } from "./webstore-core.js";

export const UPDATES = "shields:cws-updates";     // local: true turns the update check on (default off)
export const INSTALLED = "shields:cws-installed"; // local: { [id]: { name, version, installedAt } }
export const LATEST = "shields:cws-latest";       // local: { [id]: version } newer than the record
export const LATER = "shields:cws-later";         // local: { [id]: version } whose notice was put off
export const CHECKED = "shields:cws-checkedAt";   // local: time of the last update check
export const ALARM = "shield-cws-updates";
export const PERIOD_MINUTES = 24 * 60;
// No cookies, no referrer, nothing cached; the header rule does the same at the network level.
const QUIET = { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" };

const local = async (key, fallback) => (await chrome.storage.local.get(key))[key] ?? fallback;

/** The running browser's full version ("154.0.8037.97"); Google's server picks a build that runs on it. */
export async function browserVersion() {
  try {
    const { fullVersionList = [], uaFullVersion } = await navigator.userAgentData.getHighEntropyValues(["fullVersionList", "uaFullVersion"]);
    const v = fullVersionList.find((b) => b.brand === "Chromium")?.version ?? uaFullVersion;
    if (/^\d+(\.\d+){3}$/.test(v ?? "") && !/\.0\.0\.0$/.test(v)) return v;
  } catch { /* below */ }
  const m = /Chrome\/(\d+\.\d+\.\d+\.\d+)/.exec(navigator.userAgent);
  if (m && !/\.0\.0\.0$/.test(m[1])) return m[1];
  throw new Error("cannot tell the browser version");
}

// Who may ask what: the store page's own frame (Chromium fills in sender.url), or Shield's pages.
const fromStore = (sender) => sender.id === chrome.runtime.id && sender.frameId === 0 && !!sender.tab
  && typeof sender.url === "string" && sender.url.startsWith(`${STORE_ORIGIN}/`);
const fromShield = (sender) => sender.id === chrome.runtime.id && typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
const cleanName = (name, id) => (typeof name === "string" && name.trim() ? name.replace(/\s+/g, " ").trim().slice(0, 80) : id);

export async function record(id, entry) {
  const installed = await local(INSTALLED, {});
  if (entry === null) delete installed[id];
  else installed[id] = { ...installed[id], ...entry };
  const latest = await local(LATEST, {});
  const later = await local(LATER, {});
  if (latest[id] && (entry === null || (installed[id].version && compareVersions(latest[id], installed[id].version) <= 0))) delete latest[id];
  if (entry === null) delete later[id];
  await chrome.storage.local.set({ [INSTALLED]: installed, [LATEST]: latest, [LATER]: later });
}

/** The optional update check: only the extensions in Shield's record, no cookies. null when the switch is off. */
export async function checkUpdates() {
  if (!(await local(UPDATES, false))) return null;
  const installed = await local(INSTALLED, {});
  const entries = Object.entries(installed).filter(([id]) => isId(id)).map(([id, r]) => ({ id, version: r.version }));
  if (!entries.length) {
    await chrome.storage.local.set({ [LATEST]: {}, [CHECKED]: Date.now() });
    return { checked: 0, updates: 0 };
  }
  const res = await fetch(updateCheckUrl(entries, await browserVersion()), { ...QUIET, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Google answered ${res.status}`);
  const found = parseUpdateResponse(await res.text());
  const latest = {};
  for (const { id, version } of entries) {
    const v = found[id]?.version;
    if (!v) continue;
    // No version recorded (the download was not seen): take Google's as the starting point
    // rather than announce an update for what was most likely just installed.
    if (!version) { installed[id].version = v; continue; }
    if (compareVersions(v, version) > 0) latest[id] = v;
  }
  await chrome.storage.local.set({ [INSTALLED]: installed, [LATEST]: latest, [CHECKED]: Date.now() });
  return { checked: entries.length, updates: Object.keys(latest).length };
}

/** The alarm exists only while the switch is on; an existing one keeps its schedule. */
export async function schedule() {
  if (await local(UPDATES, false)) {
    if (!(await chrome.alarms.get(ALARM))) await chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES, delayInMinutes: PERIOD_MINUTES });
  } else {
    await chrome.alarms.clear(ALARM);
  }
}
const warn = (e) => console.warn(`[shield] store extensions: ${e?.message ?? e}`);
const ready = schedule().catch(warn);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[UPDATES]) return;
  void schedule().catch(warn);
  // Just turned on, by a click in Shields' settings: one check now, then once a day.
  if (changes[UPDATES].newValue === true) void checkUpdates().catch(warn);
});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) void checkUpdates().catch(warn); });

// The version, from the address Google's server redirects the download to. Only for extensions
// already in Shield's record (put there by the click), and nothing about the request is kept.
chrome.webRequest.onBeforeRedirect.addListener((d) => {
  const id = idFromCrxUrl(d.url);
  const version = id && versionFromCrxUrl(d.redirectUrl, id);
  if (!version) return;
  void (async () => {
    const installed = await local(INSTALLED, {});
    if (installed[id] && installed[id].version !== version) await record(id, { version });
  })().catch(warn);
}, { urls: [`${UPDATE_URL}*`] });

// The .crx address failed before Google's server answered (offline, blocked): the card says so.
// A download always ends its tab request as ERR_ABORTED, which is not a failure.
chrome.webRequest.onErrorOccurred.addListener((d) => {
  if (d.tabId < 0 || d.error === "net::ERR_ABORTED" || !idFromCrxUrl(d.url)) return;
  chrome.tabs.sendMessage(d.tabId, { what: "enki-shield:cws-failed" }, { frameId: 0 }).catch(() => {});
}, { urls: [`${UPDATE_URL}*`] });

async function handle(msg, sender) {
  switch (msg.what) {
    // "Continue" under the access note, on a store page: the tab opens the .crx address and
    // Chromium takes over. The page's name for the extension is only shown back to the user.
    // The card sends the id it showed; it must be the one in the tab's address (installId).
    case "enki-shield:cws-install": {
      if (!fromStore(sender)) return { error: "not from a store page" };
      const { id, error } = installId(sender.url, msg.id);
      if (error) return { error };
      const url = crxUrl(id, await browserVersion());
      const before = (await local(INSTALLED, {}))[id];
      await record(id, { name: cleanName(msg.name, id), version: before?.version ?? null, installedAt: Date.now() });
      await chrome.tabs.update(sender.tab.id, { url });
      return { ok: true };
    }
    // Shields' settings and panel.
    case "enki-shield:cws-list": {
      if (!fromShield(sender)) return null;
      return { on: await local(UPDATES, false), installed: await local(INSTALLED, {}), latest: await local(LATEST, {}), later: await local(LATER, {}), checkedAt: await local(CHECKED, 0) };
    }
    case "enki-shield:cws-forget": {
      if (!fromShield(sender) || !isId(msg.id)) return null;
      await record(msg.id, null);
      return { ok: true };
    }
    case "enki-shield:cws-later": {
      if (!fromShield(sender) || !isId(msg.id)) return null;
      const latest = (await local(LATEST, {}))[msg.id];
      if (latest) await chrome.storage.local.set({ [LATER]: { ...(await local(LATER, {})), [msg.id]: latest } });
      return { ok: true };
    }
    // "Update" on a notice: the same .crx address and Chromium prompt as the first install.
    case "enki-shield:cws-update": {
      if (!fromShield(sender) || !isId(msg.id)) return null;
      const installed = (await local(INSTALLED, {}))[msg.id];
      const latest = (await local(LATEST, {}))[msg.id];
      if (!installed || !latest) return { error: "no update" };
      await chrome.tabs.create({ url: crxUrl(msg.id, await browserVersion()) });
      // The redirect then records the version downloaded. A cancelled prompt is not seen: the
      // record says updated (the drift above); "Install in Enki" on the store page does it again.
      return { ok: true };
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (typeof msg?.what !== "string" || !msg.what.startsWith("enki-shield:cws-")) return false;
  handle(msg, sender).then(reply, (e) => reply({ error: e instanceof Error ? e.message : String(e) }));
  return true;
});

// For test/shield-webstore.mjs, which drives the worker.
globalThis.enkiShieldWebstore = { browserVersion, checkUpdates, record, schedule, ready: () => ready, CRX_HOSTS, keys: { UPDATES, INSTALLED, LATEST, LATER, CHECKED, ALARM } };
