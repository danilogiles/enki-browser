/**
 * The browser window a page of Enki belongs to, kept current when its tab moves (#115).
 *
 * Enki Home (and the conversation it hosts) learned its window once, when it mounted. Dragging the
 * tab out into a new window (tear-off) or onto another window's tab strip kept the old id, so
 * "Ask Enki" there opened the side panel in the ORIGINAL window, addressed the handoff to it, and
 * the tools went on reading the original window's tabs.
 *
 * A page in a tab follows chrome.tabs.onAttached for its own tab id. The side panel has no tab
 * (tabs.getCurrent() resolves undefined) and is docked to one window for its whole life, so it
 * gets windows.getCurrent() once and never moves. The callback runs synchronously from the event,
 * so a later click still has the right id without an await (sidePanel.open needs the gesture).
 */

type Api = {
  tabs: {
    getCurrent(): Promise<chrome.tabs.Tab | undefined>;
    onAttached: { addListener(cb: (tabId: number, info: { newWindowId: number }) => void): void; removeListener(cb: (tabId: number, info: { newWindowId: number }) => void): void };
  };
  windows: { getCurrent(): Promise<{ id?: number }> };
};

export function followOwnWindow(onWindow: (windowId: number) => void, api: Api = chrome as unknown as Api): () => void {
  let stopped = false;
  let ownTab: number | undefined;
  let last: number | undefined;
  const emit = (id: number | undefined) => {
    if (stopped || id === undefined || id === last) return;
    last = id;
    onWindow(id);
  };
  const onAttached = (tabId: number, info: { newWindowId: number }) => {
    if (ownTab !== undefined && tabId === ownTab) emit(info.newWindowId);
  };
  api.tabs.onAttached.addListener(onAttached);
  void api.tabs.getCurrent().then(
    (tab) => {
      if (tab?.id !== undefined) { ownTab = tab.id; emit(tab.windowId); return; }
      return api.windows.getCurrent().then((w) => emit(w.id));
    },
    () => api.windows.getCurrent().then((w) => emit(w.id), () => undefined),
  );
  return () => { stopped = true; api.tabs.onAttached.removeListener(onAttached); };
}
