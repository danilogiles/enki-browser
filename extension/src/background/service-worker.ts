/**
 * Enki background service worker. Deliberately thin: the agent runs inside the side panel page
 * (which stays alive while open); the worker only wires up how the panel gets opened.
 */

const PANEL_PATH = "src/sidepanel/index.html";
const hasSidePanel = typeof chrome.sidePanel !== "undefined";

function enablePanelOnActionClick() {
  if (!hasSidePanel) return;
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e) => console.error(e));
}

/** Opens the panel for a window. Falls back to a popup window on browsers without chrome.sidePanel. */
async function openPanel(windowId: number | undefined): Promise<void> {
  if (hasSidePanel && windowId !== undefined) {
    try {
      await chrome.sidePanel.open({ windowId });
      return;
    } catch (e) {
      console.warn("sidePanel.open failed, falling back to popup", e);
    }
  }
  const url = chrome.runtime.getURL(`${PANEL_PATH}?window=${windowId ?? ""}`);
  const existing = await chrome.tabs.query({ url: `${chrome.runtime.getURL(PANEL_PATH)}*` });
  if (existing[0]?.windowId !== undefined) {
    await chrome.windows.update(existing[0].windowId, { focused: true });
    return;
  }
  await chrome.windows.create({ url, type: "popup", width: 440, height: 760 });
}

chrome.runtime.onInstalled.addListener(enablePanelOnActionClick);
chrome.runtime.onStartup.addListener(enablePanelOnActionClick);
enablePanelOnActionClick();

// Fires only when openPanelOnActionClick is not in effect (unsupported API, or the call failed).
chrome.action.onClicked.addListener((tab) => {
  openPanel(tab.windowId).catch((e) => console.error(e));
});

chrome.commands.onCommand.addListener(async (command) => {
  const win = await chrome.windows.getLastFocused();
  if (command === "open-panel") { await openPanel(win.id); return; }
  if (!["focus-composer", "stop-task", "new-chat"].includes(command)) return;
  // Focusing the composer should also open the panel if it is closed; the other two are only
  // meaningful for a task that is already running. A freshly opened panel needs a moment to
  // mount before its listener exists, so retry briefly instead of dropping the keystroke.
  const attempts = command === "focus-composer" ? 5 : 1;
  if (command === "focus-composer") await openPanel(win.id);
  for (let i = 0; i < attempts; i++) {
    const delivered = await chrome.runtime
      .sendMessage({ type: "enki:command", command, windowId: win.id })
      .then(() => true, () => false);
    if (delivered) return;
    await new Promise((r) => setTimeout(r, 150));
  }
});

/**
 * At startup Chromium can paint the first new tab before command-line extensions have loaded,
 * so the window opened on Chromium's own new tab page instead of Enki Home. Once the override
 * exists, send those tabs to the new tab page again. Only builds that override the new tab
 * (Enki Browser's) have anything to fix; the store extension leaves the new tab alone.
 *
 * Both kinds of tab report chrome://newtab/, so the ones already showing Enki Home — pages of
 * this extension — are told apart through runtime.getContexts and left alone (a reload would
 * lose what the user started typing). runtime.onStartup was tried first and does not fire
 * reliably for extensions loaded from the command line; the first run of the service worker in
 * a browser session (session storage starts empty) is the dependable signal.
 */
async function reopenEarlyNewTabs(): Promise<void> {
  const ours = new Set((await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] })).map((c) => c.tabId));
  for (const tab of await chrome.tabs.query({})) {
    const url = tab.pendingUrl || tab.url || "";
    if (tab.id !== undefined && !ours.has(tab.id) && /^chrome:\/\/(newtab|new-tab-page(-third-party)?)\/?$/.test(url)) {
      await chrome.tabs.update(tab.id, { url: "chrome://newtab/" }).catch(() => undefined);
    }
  }
}
const overridesNewTab = !!(chrome.runtime.getManifest() as chrome.runtime.Manifest & { chrome_url_overrides?: { newtab?: string } }).chrome_url_overrides?.newtab;
if (overridesNewTab) {
  void chrome.storage.session.get("enki:session-started").then(async (v) => {
    if (v["enki:session-started"]) return;
    await chrome.storage.session.set({ "enki:session-started": Date.now() });
    // The restored windows may still be opening; look again shortly after.
    for (const delay of [0, 1500, 4000]) setTimeout(() => void reopenEarlyNewTabs(), delay);
  });
}
