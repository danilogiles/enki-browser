// Burn and shred, in the background so they finish after the panel closes (closing every tab
// takes the panel's focus away, and with it the panel).
//
// Burn is DuckDuckGo's Fire Button: every tab closed, then history, cookies, site storage, cache,
// download history and autofill deleted. Passwords and bookmarks stay, and so does everything
// extensions keep (Enki's settings and chats): browsingData only touches website data unless
// asked otherwise. Shred is Brave's "shred site data": one site's data and tabs.
//
// "Burn when the browser closes" sets cookies to last only for the session, so cookies and site
// data die with the last window, and wipes the rest (history, cache) when the browser next opens,
// before anything else runs: Chromium gives extensions no moment at shutdown to do it then.

export const AUTO_BURN = "shields:auto-burn";

const EVERYTHING = {
  cache: true, cacheStorage: true, cookies: true, downloads: true, fileSystems: true, formData: true,
  history: true, indexedDB: true, localStorage: true, serviceWorkers: true, webSQL: true,
};

/** Closes every tab, leaving one new tab, then deletes the browsing data. */
export async function burnAll() {
  const win = await chrome.windows.getLastFocused().catch(() => null);
  const fresh = await chrome.tabs.create({ url: "chrome://newtab/", windowId: win?.id, active: true });
  const others = (await chrome.tabs.query({})).filter((t) => t.id !== fresh.id).map((t) => t.id);
  if (others.length) await chrome.tabs.remove(others).catch(() => {});
  await chrome.browsingData.remove({ since: 0 }, EVERYTHING);
  return { closed: others.length };
}

/** One site: its tabs closed (the panel's own tab gets a new tab instead) and its data deleted. */
export async function shredSite(host) {
  const bare = host.replace(/^www\./, "");
  const matches = (url) => { try { const h = new URL(url).hostname; return h === bare || h.endsWith(`.${bare}`); } catch { return false; } };
  const tabs = (await chrome.tabs.query({})).filter((t) => matches(t.url ?? ""));
  if (tabs.length && tabs.length === (await chrome.tabs.query({})).length) await chrome.tabs.create({ url: "chrome://newtab/" });
  if (tabs.length) await chrome.tabs.remove(tabs.map((t) => t.id)).catch(() => {});
  const origins = [...new Set([bare, `www.${bare}`, host])].flatMap((h) => [`https://${h}`, `http://${h}`]);
  await chrome.browsingData.remove({ origins }, {
    cacheStorage: true, cookies: true, fileSystems: true, indexedDB: true, localStorage: true, serviceWorkers: true, webSQL: true,
  });
  return { closed: tabs.length };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg?.type === "shields:burn") { burnAll().then(reply, (e) => reply({ error: String(e) })); return true; }
  if (msg?.type === "shields:shred" && typeof msg.host === "string") { shredSite(msg.host).then(reply, (e) => reply({ error: String(e) })); return true; }
});

// When the browser opens with "burn when the browser closes" on, wipe what the last session left
// (the service worker's first run in a session: session storage starts empty).
chrome.storage.session.get("shields:session").then(async (v) => {
  if (v["shields:session"]) return;
  await chrome.storage.session.set({ "shields:session": Date.now() });
  if ((await chrome.storage.local.get(AUTO_BURN))[AUTO_BURN] === true) {
    await chrome.browsingData.remove({ since: 0 }, { ...EVERYTHING, cookies: true });
  }
});
