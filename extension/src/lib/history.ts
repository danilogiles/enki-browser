/**
 * Past conversations, kept on this device only (chrome.storage.local), newest first.
 *
 * An index of `{ id, title, updatedAt }` lists them; each conversation's snapshot lives under its
 * own key, so opening the list never loads every transcript. Snapshots come from
 * snapshotConversation, which already strips screenshots and reasoning.
 *
 * Both are stored sealed (AES-256-GCM, lib/secrets.ts): a conversation holds what the user asked
 * and the page content Enki read, and the index's titles are the first lines of those questions.
 * In the clear stay only what another document needs to notice a change without decrypting: the
 * save time and the message count. Chats written before sealing are sealed the first time they
 * are read.
 */
import { CONVERSATION_KEY, restoreConversation, type Conversation } from "./conversation";
import { decrypt, encrypt } from "./secrets";

type Sealed = { sealed: string; savedAt: number; count: number };
const isSealed = (v: unknown): v is Sealed => !!v && typeof v === "object" && typeof (v as Sealed).sealed === "string";

async function seal(c: Conversation): Promise<Sealed> {
  return { sealed: await encrypt(JSON.stringify(c)), savedAt: c.savedAt, count: c.messages.length };
}

/** A stored chat (sealed, or plain from before sealing) back into a conversation. */
export async function openStoredChat(value: unknown): Promise<Conversation | null> {
  if (!isSealed(value)) return restoreConversation(value);
  const plain = await decrypt(value.sealed);
  if (!plain) return null;
  try { return restoreConversation(JSON.parse(plain)); } catch { return null; }
}

/** The save time of a stored chat, readable without decrypting it. */
export const storedSavedAt = (value: unknown): number | undefined =>
  isSealed(value) ? value.savedAt : (value as { savedAt?: number } | undefined)?.savedAt;

async function readIndex(): Promise<{ list: ChatEntry[] | undefined; plain: boolean }> {
  const raw = (await chrome.storage.local.get(INDEX))[INDEX] as ChatEntry[] | { sealed: string } | undefined;
  if (raw === undefined) return { list: undefined, plain: false };
  if (Array.isArray(raw)) return { list: raw, plain: true };
  try { return { list: JSON.parse((await decrypt(raw.sealed)) || "[]") as ChatEntry[], plain: false }; }
  catch { return { list: [], plain: false }; }
}

async function sealIndex(list: ChatEntry[]): Promise<{ sealed: string }> {
  return { sealed: await encrypt(JSON.stringify(list)) };
}

export type ChatEntry = { id: string; title: string; updatedAt: number };

const INDEX = "enki:chats";
/** The chat open in the panel, reopened when the panel is; cleared by New chat. */
const CURRENT = "enki:current-chat";

export async function currentChat(): Promise<string | null> {
  const stored = (await chrome.storage.local.get(CURRENT))[CURRENT] as string | undefined;
  if (stored !== undefined) return stored || null;
  // Before this was tracked, the panel reopened the latest conversation; keep that once.
  return (await listChats())[0]?.id ?? null;
}

export function setCurrentChat(id: string | null): Promise<void> {
  return chrome.storage.local.set({ [CURRENT]: id ?? "" });
}
const PREFIX = "enki:chat:";
/** The storage key one conversation lives under. Exported so another document can watch for the
 *  moment this chat changes under it — the side panel and Enki Home now hold the same one. */
export const chatKey = (id: string): string => PREFIX + id;
/** Older chats beyond this are dropped; local storage is not an archive. */
const MAX_CHATS = 50;

export async function listChats(): Promise<ChatEntry[]> {
  const { list: stored, plain } = await readIndex();
  if (stored && plain) {
    // Written before sealing: seal the index and every chat it lists, once.
    const updates: Record<string, unknown> = { [INDEX]: await sealIndex(stored) };
    const raws = await chrome.storage.local.get(stored.map((c) => PREFIX + c.id));
    for (const [key, value] of Object.entries(raws)) {
      const chat = isSealed(value) ? null : restoreConversation(value);
      if (chat) updates[key] = await seal(chat);
    }
    await chrome.storage.local.set(updates);
    return stored;
  }
  if (stored) return stored;
  // Before history existed, only the latest conversation was kept: it becomes the first entry.
  const legacy = restoreConversation((await chrome.storage.local.get(CONVERSATION_KEY))[CONVERSATION_KEY]);
  if (!legacy) return [];
  const entry = { id: `legacy-${legacy.savedAt}`, title: titleOf(legacy), updatedAt: legacy.savedAt };
  await chrome.storage.local.set({ [INDEX]: await sealIndex([entry]), [PREFIX + entry.id]: await seal(legacy) });
  await chrome.storage.local.remove(CONVERSATION_KEY);
  return [entry];
}

export async function loadChat(id: string): Promise<Conversation | null> {
  const raw = (await chrome.storage.local.get(PREFIX + id))[PREFIX + id];
  const chat = await openStoredChat(raw);
  if (chat && raw !== undefined && !isSealed(raw)) await chrome.storage.local.set({ [PREFIX + id]: await seal(chat) });
  return chat;
}

// Serialize writes so an older checkpoint cannot overwrite a newer one.
let writes: Promise<unknown> = Promise.resolve();

export function saveChat(id: string, conversation: Conversation): Promise<unknown> {
  writes = writes.catch(() => undefined).then(async () => {
    const index = (await listChats()).filter((c) => c.id !== id);
    const entry = { id, title: titleOf(conversation), updatedAt: Date.now() };
    const kept = [entry, ...index].slice(0, MAX_CHATS);
    const dropped = [entry, ...index].slice(MAX_CHATS).map((c) => PREFIX + c.id);
    await chrome.storage.local.set({ [INDEX]: await sealIndex(kept), [PREFIX + id]: await seal(conversation) });
    if (dropped.length) await chrome.storage.local.remove(dropped);
  });
  return writes;
}

export function deleteChat(id: string): Promise<unknown> {
  writes = writes.catch(() => undefined).then(async () => {
    const index = (await listChats()).filter((c) => c.id !== id);
    await chrome.storage.local.set({ [INDEX]: await sealIndex(index) });
    await chrome.storage.local.remove(PREFIX + id);
  });
  return writes;
}

/** Turning off "save conversations" removes every saved chat. */
export function clearChats(): Promise<unknown> {
  writes = writes.catch(() => undefined).then(async () => {
    const { list: index } = await readIndex();
    // Also anything under the prefix the index no longer names, so nothing is left behind.
    const strays = Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith(PREFIX));
    await chrome.storage.local.remove([...new Set([INDEX, CURRENT, CONVERSATION_KEY, ...(index ?? []).map((c) => PREFIX + c.id), ...strays])]);
  });
  return writes;
}

function titleOf(c: Conversation): string {
  const first = c.messages.find((m) => m.role === "user" && m.text?.trim())?.text ?? "New chat";
  const line = first.trim().split("\n")[0];
  return line.length > 60 ? line.slice(0, 57) + "…" : line;
}
