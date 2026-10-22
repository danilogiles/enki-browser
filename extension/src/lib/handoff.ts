/**
 * A request typed somewhere other than the side panel — the Enki Home new tab page — waiting for
 * the panel to pick it up. It lives in session storage: gone when the browser closes, readable
 * only by this extension's own pages, and never persisted to disk.
 *
 * The page that writes it opens the panel in the same click (sidePanel.open needs the user's
 * gesture), so the panel may mount before or after the write lands; `takeHandoff` covers the
 * first case and `onHandoff` the second.
 *
 * It is addressed to one window. Every open panel, in every window, hears the storage change, so
 * an unaddressed handoff went to whichever panel claimed it first: Act typed on Home in a new
 * window ran in another window's panel, driving that window's tabs. Only the panel docked in
 * (or, as a tab, pointed at with `?window=`) the window the request was typed in may take it.
 */
export type Handoff = { text: string; mode: "ask" | "act"; at: number; windowId: number };

const KEY = "enki:handoff";
/** Older than this, the user has moved on; sending it now would surprise them. */
const MAX_AGE_MS = 60_000;

export async function putHandoff(text: string, mode: Handoff["mode"], windowId: number): Promise<void> {
  await chrome.storage.session.set({ [KEY]: { text, mode, at: Date.now(), windowId } satisfies Handoff });
}

/**
 * Returns the pending request once, removing it so it can never be sent twice. A request for
 * another window (or one with no window, written by an older build) is left alone: it is not
 * this panel's to send.
 */
export async function takeHandoff(windowId: number | undefined): Promise<Handoff | null> {
  const stored = (await chrome.storage.session.get(KEY))[KEY] as Handoff | undefined;
  if (!stored || windowId === undefined || stored.windowId !== windowId) return null;
  await chrome.storage.session.remove(KEY);
  return Date.now() - stored.at < MAX_AGE_MS && stored.text.trim() ? stored : null;
}

export function onHandoff(cb: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "session" && changes[KEY]?.newValue) cb();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
