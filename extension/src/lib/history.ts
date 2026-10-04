/**
 * Past conversations, kept on this device only (chrome.storage.local), newest first.
 *
 * An index of `{ id, title, updatedAt }` lists them; each conversation's snapshot lives under its
 * own key, so opening the list never loads every transcript. Snapshots come from
 * snapshotConversation, which already strips screenshots and reasoning.
 */
import { CONVERSATION_KEY, restoreConversation, type Conversation } from "./conversation";

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
/** Older chats beyond this are dropped; local storage is not an archive. */
const MAX_CHATS = 50;

export async function listChats(): Promise<ChatEntry[]> {
  const stored = (await chrome.storage.local.get(INDEX))[INDEX] as ChatEntry[] | undefined;
  if (stored) return stored;
  // Before history existed, only the latest conversation was kept: it becomes the first entry.
  const legacy = restoreConversation((await chrome.storage.local.get(CONVERSATION_KEY))[CONVERSATION_KEY]);
  if (!legacy) return [];
  const entry = { id: `legacy-${legacy.savedAt}`, title: titleOf(legacy), updatedAt: legacy.savedAt };
  await chrome.storage.local.set({ [INDEX]: [entry], [PREFIX + entry.id]: legacy });
  await chrome.storage.local.remove(CONVERSATION_KEY);
  return [entry];
}

export async function loadChat(id: string): Promise<Conversation | null> {
  return restoreConversation((await chrome.storage.local.get(PREFIX + id))[PREFIX + id]);
}

// Serialize writes so an older checkpoint cannot overwrite a newer one.
let writes: Promise<unknown> = Promise.resolve();

export function saveChat(id: string, conversation: Conversation): Promise<unknown> {
  writes = writes.catch(() => undefined).then(async () => {
    const index = (await listChats()).filter((c) => c.id !== id);
    const entry = { id, title: titleOf(conversation), updatedAt: Date.now() };
    const kept = [entry, ...index].slice(0, MAX_CHATS);
    const dropped = [entry, ...index].slice(MAX_CHATS).map((c) => PREFIX + c.id);
    await chrome.storage.local.set({ [INDEX]: kept, [PREFIX + id]: conversation });
    if (dropped.length) await chrome.storage.local.remove(dropped);
  });
  return writes;
}

export function deleteChat(id: string): Promise<unknown> {
  writes = writes.catch(() => undefined).then(async () => {
    const index = (await listChats()).filter((c) => c.id !== id);
    await chrome.storage.local.set({ [INDEX]: index });
    await chrome.storage.local.remove(PREFIX + id);
  });
  return writes;
}

/** Turning off "save conversations" removes every saved chat. */
export function clearChats(): Promise<unknown> {
  writes = writes.catch(() => undefined).then(async () => {
    const index = (await chrome.storage.local.get(INDEX))[INDEX] as ChatEntry[] | undefined;
    await chrome.storage.local.remove([INDEX, CURRENT, CONVERSATION_KEY, ...(index ?? []).map((c) => PREFIX + c.id)]);
  });
  return writes;
}

function titleOf(c: Conversation): string {
  const first = c.messages.find((m) => m.role === "user" && m.text?.trim())?.text ?? "New chat";
  const line = first.trim().split("\n")[0];
  return line.length > 60 ? line.slice(0, 57) + "…" : line;
}
