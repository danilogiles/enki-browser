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
  if (command !== "open-panel") return;
  const win = await chrome.windows.getLastFocused();
  await openPanel(win.id);
});
