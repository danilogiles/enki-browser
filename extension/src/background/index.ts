/**
 * Enki background service worker. Deliberately thin: the agent runs inside the side panel page
 * (which stays alive while open); the worker only wires up the panel and the keyboard shortcut.
 */

function enablePanelOnActionClick() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e) => console.error(e));
}

chrome.runtime.onInstalled.addListener(enablePanelOnActionClick);
chrome.runtime.onStartup.addListener(enablePanelOnActionClick);
enablePanelOnActionClick();

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-panel") return;
  const win = await chrome.windows.getLastFocused();
  if (win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id });
});
