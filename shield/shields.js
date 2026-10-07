import { forgetList } from "./sites.js";

// Enki Shields, the background half: what was blocked on each tab, and "forget me when I close
// this site". The panel (popup.js) reads what is recorded here and owns the per-site switches.
//
// Counting. Ads and trackers are blocked by uBlock Origin Lite, a separate extension whose rule
// matches no other extension can read. What every extension can see is the outcome: a request
// refused by a content blocker fails with net::ERR_BLOCKED_BY_CLIENT, and a script uBlock
// replaces with a harmless stub is redirected into an extension. Both count, per tab, from the
// moment a page commits, which matches what Brave's Shields panel shows.
//
// The service worker sleeps; the per-tab record lives in session storage (gone when the browser
// closes, never on disk) and is mirrored in memory while awake.

const TABS = "shields:tabs";     // session: { [tabId]: { host, count, hosts: { [host]: n } } }
const FORGET = "shields:forget"; // local: [host] — clear the site's data once its last tab closes
const BADGE = "shields:badge";   // local: false hides the count on the toolbar button

let tabs = null;
let showBadge = true;
let saving = null;

const ready = (async () => {
  tabs = (await chrome.storage.session.get(TABS))[TABS] ?? {};
  showBadge = (await chrome.storage.local.get(BADGE))[BADGE] !== false;
})();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[BADGE]) {
    showBadge = changes[BADGE].newValue !== false;
    for (const [id, t] of Object.entries(tabs ?? {})) badge(Number(id), t.count);
  }
});

function save() {
  if (saving) return;
  saving = setTimeout(() => { saving = null; chrome.storage.session.set({ [TABS]: tabs }); }, 250);
}

function badge(tabId, count) {
  const text = showBadge && count ? (count > 99 ? "99+" : String(count)) : "";
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}
chrome.action.setBadgeBackgroundColor({ color: "#e8590c" }).catch(() => {});
chrome.action.setBadgeTextColor?.({ color: "#ffffff" })?.catch?.(() => {});

async function record(tabId, url) {
  if (tabId < 0) return;
  let host;
  try { host = new URL(url).hostname; } catch { return; }
  await ready;
  const t = (tabs[tabId] ??= { host: "", count: 0, hosts: {} });
  t.count++;
  t.hosts[host] = (t.hosts[host] ?? 0) + 1;
  save();
  badge(tabId, t.count);
}

chrome.webRequest.onErrorOccurred.addListener((d) => {
  // A blocked top-level page is Enki Shield's own phishing warning, reported there instead.
  if (d.error === "net::ERR_BLOCKED_BY_CLIENT" && d.type !== "main_frame") void record(d.tabId, d.url);
}, { urls: ["<all_urls>"] });

chrome.webRequest.onBeforeRedirect.addListener((d) => {
  if (d.type !== "main_frame" && d.redirectUrl.startsWith("chrome-extension://")) void record(d.tabId, d.url);
}, { urls: ["<all_urls>"] });

// A new page in the tab starts a new count, as the panel describes "this site".
chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  await ready;
  let host = "";
  try { host = new URL(d.url).hostname; } catch { /* not a web page */ }
  tabs[d.tabId] = { host, count: 0, hosts: {} };
  save();
  badge(d.tabId, 0);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  const host = tabs[tabId]?.host;
  delete tabs[tabId];
  save();
  if (!host) return;
  const forget = await forgetList();
  if (!forget.includes(host)) return;
  // Other tabs on the same site keep it alive, as in Brave.
  if (Object.values(tabs).some((t) => t.host === host)) return;
  const origins = [`https://${host}`, `http://${host}`];
  await chrome.browsingData.remove({ origins }, {
    cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true, fileSystems: true,
  }).catch(() => {});
});
