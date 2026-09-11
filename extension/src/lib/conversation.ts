import type { Message } from "./types";
import type { UiMessage } from "../sidepanel/types";
import { invalidateObservations, repairInterruptedHistory } from "./agent/context";

export const CONVERSATION_KEY = "enki:conversation";
export type Conversation = { version: 1; history: Message[]; messages: UiMessage[]; savedAt: number };

/** Local only. Screenshots and reasoning are deliberately excluded from saved conversations. */
export function snapshotConversation(history: Message[], messages: UiMessage[]): Conversation {
  const clean = JSON.parse(JSON.stringify(history, (key, value) => key === "data" ? "" : value)) as Message[];
  invalidateObservations(clean);
  for (const m of clean) if (m.role === "tool") for (const p of m.parts) {
    p.content = p.content.filter((c) => c.type !== "image");
    if (!p.content.length) p.content = [{ type: "text", text: "[Image not saved. Read the current page again.]" }];
  }
  repairInterruptedHistory(clean);
  return {
    version: 1, savedAt: Date.now(), history: clean,
    messages: messages.slice(-100).map((m) => ({ ...m, screenshot: undefined, thinking: undefined,
      text: m.text?.slice(0, 20000), segments: m.segments?.map((s) => s.kind === "text"
        ? { ...s, text: s.text.slice(0, 20000) } : { ...s, output: s.output?.slice(0, 2000) }) })),
  };
}

export function restoreConversation(value: unknown): Conversation | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Conversation;
  if (v.version !== 1 || !Array.isArray(v.history) || !Array.isArray(v.messages)) return null;
  try {
    repairInterruptedHistory(v.history);
    invalidateObservations(v.history);
    v.messages = v.messages.map((m) => ({ ...m, streaming: false,
      note: m.streaming ? "Interrupted when the panel closed. Continue will inspect the current page first." : m.note,
      segments: m.segments?.map((s) => s.kind === "tool" && (s.status === "running" || s.status === "awaiting")
        ? { ...s, status: "error", output: "Interrupted. Outcome unknown; inspect the page before continuing." } : s),
    }));
    return v;
  } catch { return null; }
}

// Serialize writes so an older checkpoint cannot overwrite a newer one.
let writes: Promise<unknown> = Promise.resolve();
export function saveConversation(value: Conversation | null): Promise<unknown> {
  writes = writes.catch(() => undefined).then(() => value
    ? chrome.storage.local.set({ [CONVERSATION_KEY]: value }) : chrome.storage.local.remove(CONVERSATION_KEY));
  return writes;
}
