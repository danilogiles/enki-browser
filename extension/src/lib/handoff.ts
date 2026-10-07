/**
 * A request typed somewhere other than the side panel — the Enki Home new tab page — waiting for
 * the panel to pick it up. It lives in session storage: gone when the browser closes, readable
 * only by this extension's own pages, and never persisted to disk.
 *
 * The page that writes it opens the panel in the same click (sidePanel.open needs the user's
 * gesture), so the panel may mount before or after the write lands; `takeHandoff` covers the
 * first case and `onHandoff` the second.
 */
export type Handoff = { text: string; mode: "ask" | "act"; at: number };

const KEY = "enki:handoff";
/** Older than this, the user has moved on; sending it now would surprise them. */
const MAX_AGE_MS = 60_000;

export async function putHandoff(text: string, mode: Handoff["mode"]): Promise<void> {
  await chrome.storage.session.set({ [KEY]: { text, mode, at: Date.now() } satisfies Handoff });
}

/** Returns the pending request once, removing it so it can never be sent twice. */
export async function takeHandoff(): Promise<Handoff | null> {
  const stored = (await chrome.storage.session.get(KEY))[KEY] as Handoff | undefined;
  if (!stored) return null;
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
