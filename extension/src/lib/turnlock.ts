/**
 * One turn at a time, per conversation.
 *
 * Enki now answers in two places at once: the side panel, and Enki Home answering in place. Both
 * are separate documents holding the same conversation, so without this a question typed in one
 * while the other is still answering would run a second turn against the same history — two
 * writers, one transcript, and the loser's messages silently overwritten.
 *
 * Session storage rather than local: a lock is only meaningful while the browser is open, and a
 * stale one left by a crashed document must not outlive the session. It also expires on its own,
 * because a document can be closed mid-turn and never reach its release.
 */
const KEY = "enki:turn";

/** Long enough for a slow model and several tool steps; short enough that a crashed document does
 *  not wedge the conversation for the rest of the session. The holder renews it as it works. */
const STALE_MS = 90_000;

type Lock = { chatId: string; owner: string; at: number };

/** Identifies this document. Two panels cannot exist, but a panel and a Home page can. */
export const DOC_ID = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

async function read(): Promise<Lock | null> {
  const stored = (await chrome.storage.session.get(KEY))[KEY] as Lock | undefined;
  if (!stored) return null;
  return Date.now() - stored.at < STALE_MS ? stored : null;
}

/** True when someone else is mid-turn on this conversation right now. */
export async function heldElsewhere(chatId: string | null): Promise<boolean> {
  if (!chatId) return false;
  const lock = await read();
  return !!lock && lock.chatId === chatId && lock.owner !== DOC_ID;
}

export async function acquireTurn(chatId: string | null): Promise<boolean> {
  if (!chatId) return true;             // a chat with no id yet is this document's alone
  if (await heldElsewhere(chatId)) return false;
  await chrome.storage.session.set({ [KEY]: { chatId, owner: DOC_ID, at: Date.now() } satisfies Lock });
  return true;
}

/** Push the expiry out while a long turn is still working. */
export async function renewTurn(chatId: string | null): Promise<void> {
  if (!chatId) return;
  const lock = await read();
  if (lock?.owner !== DOC_ID) return;
  await chrome.storage.session.set({ [KEY]: { chatId, owner: DOC_ID, at: Date.now() } satisfies Lock });
}

export async function releaseTurn(): Promise<void> {
  const lock = (await chrome.storage.session.get(KEY))[KEY] as Lock | undefined;
  if (lock && lock.owner !== DOC_ID) return;   // never release someone else's
  await chrome.storage.session.remove(KEY);
}
