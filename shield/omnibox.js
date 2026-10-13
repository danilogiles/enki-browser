// The address bar must never turn a typed search into a website address.
//
// Chromium turns typed text into http://<the text>/ when the profile has no usable default search
// engine, and ungoogled-chromium has no built-in engine to fall back on. The search then goes out
// as a DNS lookup of the words typed ("elon%20musk%20github"), unencrypted, and ends on
// ERR_NAME_NOT_RESOLVED. That happens when Chromium resets the profile's default engine (it is a
// protected setting) and nothing is left in its place.
//
// Two safety nets, neither of which touches the user's engine choice:
//  - rules/omnibox.json, a static declarativeNetRequest rule: a main-frame address whose host
//    contains an encoded space can only be typed words (no real host name has a space), so it is
//    sent to DuckDuckGo before any DNS lookup or connection. Static, so it holds from the first
//    navigation, before this service worker has even started.
//  - here (tabs.onUpdated): profiles from 0.7.2–0.8.7 search with Enki's panel page. When Enki is missing or
//    disabled that page cannot open, so the search goes to DuckDuckGo instead of an error page.
export const ENKI_ID = "caelfocbikejgdamghjlkpmbbaobehlp";
const ENKI_SEARCH = `chrome-extension://${ENKI_ID}/src/sidepanel/index.html?`;

export function ddgUrl(q) {
  return `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
}

/** The DuckDuckGo address for a failed navigation to Enki's search page, or null. */
export function enkiSearchFallback(url) {
  if (typeof url !== "string" || !url.startsWith(ENKI_SEARCH)) return null;
  const q = new URLSearchParams(url.slice(ENKI_SEARCH.length)).get("q")?.trim();
  return q ? ddgUrl(q) : null;
}

/** Same match as rules/omnibox.json, for tests. */
export const TYPED_WORDS = /^https?:\/\/([^/?#:@]*%20[^/?#:@]*)\/?$/i;

/** Whether a finished tab is Enki's search page that did not open: Chromium shows its error page
 *  in place of the extension page, titled with its address, where Enki's page is titled "Enki" (or "<question> — Enki"). */
export function enkiSearchFailed(tab) {
  return !!enkiSearchFallback(tab?.url) && tab.status === "complete" && !/(^|— )Enki$/.test(tab.title ?? "");
}

if (globalThis.chrome?.tabs?.onUpdated) {
  // webNavigation reports nothing for another extension's pages; tabs (url and title) does.
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status !== "complete" || !enkiSearchFailed(tab)) return;
    chrome.tabs.update(tabId, { url: enkiSearchFallback(tab.url) }).catch(() => {});
  });
}
