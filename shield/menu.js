// "Check for updates" in the Shields button's right-click menu: opens Shields' settings at the
// update check (options.html#check-updates, which runs the check when the page opens).
//
// Menu items outlive the worker but not a reinstall, and onInstalled/onStartup do not fire
// reliably for extensions loaded from the command line, so the item is (re)made whenever the
// worker starts: removed first, then created, so it never fails as a duplicate.

const MENU = { id: "shield-check-updates", title: "Check for updates", contexts: ["action"] };
const UPDATES_URL = "options.html#check-updates";

function call(fn, ...args) {
  return new Promise((resolve) => fn(...args, () => resolve(chrome.runtime.lastError ?? null)));
}

let making = null;
export function makeMenu() {
  making ??= (async () => {
    await call(chrome.contextMenus.remove.bind(chrome.contextMenus), MENU.id); // absent is fine
    const error = await call(chrome.contextMenus.create.bind(chrome.contextMenus), { ...MENU });
    if (error) console.warn("Shields menu:", error.message);
  })().finally(() => { making = null; });
  return making;
}

export async function openUpdateCheck() {
  await chrome.tabs.create({ url: chrome.runtime.getURL(UPDATES_URL) });
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU.id) void openUpdateCheck();
});
chrome.runtime.onInstalled.addListener(() => void makeMenu());
chrome.runtime.onStartup.addListener(() => void makeMenu());
void makeMenu();

// For test/shield-menu.mjs, which cannot open a toolbar button's context menu: what the item is
// and what clicking it does. Reachable only from this extension's own worker.
globalThis.enkiShieldMenu = { item: MENU, open: openUpdateCheck, make: makeMenu };
