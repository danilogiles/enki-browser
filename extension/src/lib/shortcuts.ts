/**
 * Saved tasks and @mentions, typed at the start of a message.
 *
 * `/name extra words` runs a saved task: its prompt (plus the extra words) is what gets sent, in
 * the mode the task was saved with. It works on whatever site is open, through the browser tools,
 * so it covers apps that have no MCP server.
 *
 * `@app` points the request at one connected app; the model is told which tools that means.
 */
import type { Mode } from "./agent/prompt";
import { toolName, type Connection } from "./connectors";
import { decrypt, encrypt } from "./secrets";

export type SavedTask = { id: string; name: string; prompt: string; mode: Mode };

const KEY = "enki:tasks";

// Saved tasks are prompts the user wrote, stored sealed like chats (lib/secrets.ts); a list
// written before sealing is sealed the first time it is read.
export async function loadTasks(): Promise<SavedTask[]> {
  const raw = (await chrome.storage.local.get(KEY))[KEY] as SavedTask[] | { sealed: string } | undefined;
  if (!raw) return [];
  if (Array.isArray(raw)) { await saveTasks(raw); return raw; }
  try { return JSON.parse((await decrypt(raw.sealed)) || "[]") as SavedTask[]; } catch { return []; }
}

export async function saveTasks(tasks: SavedTask[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: { sealed: await encrypt(JSON.stringify(tasks)) } });
}

/** What follows / or @: lowercase, no spaces or accents. */
export const handle = (name: string) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export type Expanded = { text: string; mode?: Mode; hint?: string; task?: SavedTask; app?: Connection };

export function expand(input: string, tasks: SavedTask[], apps: Connection[]): Expanded {
  const text = input.trim();
  const slash = /^\/([^\s]+)\s*([\s\S]*)$/.exec(text);
  if (slash) {
    const task = tasks.find((t) => handle(t.name) === handle(slash[1]));
    if (task) return { text: slash[2] ? `${task.prompt}\n\n${slash[2]}` : task.prompt, mode: task.mode, task };
  }
  const at = /^@([^\s]+)\s*([\s\S]*)$/.exec(text);
  if (at) {
    const app = apps.find((a) => a.enabled && a.status === "connected" && handle(a.name) === handle(at[1]));
    if (app) {
      const prefix = app.tools[0] ? toolName(app, app.tools[0]).split("__")[0] : handle(app.name);
      return { text: at[2] || text, app, hint: `[Use ${app.name} for this: its tools are the ones named ${prefix}__…]` };
    }
  }
  return { text };
}

/** Suggestions for the composer while the user types `/…` or `@…` at the start. */
export function suggestions(input: string, tasks: SavedTask[], apps: Connection[]): Array<{ insert: string; label: string; detail: string }> {
  const m = /^([/@])([^\s]*)$/.exec(input);
  if (!m) return [];
  const q = handle(m[2]);
  if (m[1] === "/") {
    return tasks.filter((t) => handle(t.name).startsWith(q)).slice(0, 6)
      .map((t) => ({ insert: `/${handle(t.name)} `, label: `/${handle(t.name)}`, detail: t.prompt.slice(0, 70) }));
  }
  return apps.filter((a) => a.enabled && a.status === "connected" && handle(a.name).startsWith(q)).slice(0, 6)
    .map((a) => ({ insert: `@${handle(a.name)} `, label: `@${handle(a.name)}`, detail: `${a.name} · ${a.tools.length} tools` }));
}
