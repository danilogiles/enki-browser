/**
 * In-memory diagnostic log for the side panel.
 *
 * Entries are always recorded into a small ring buffer so the Logs view has something useful
 * right after a failure, without the user having to reproduce it with a flag turned on.
 * Dev mode additionally mirrors everything to the console.
 *
 * Never pass credentials in here: `redact` scrubs the obvious carriers, but the rule is that
 * API keys and Authorization headers do not enter a log entry in the first place.
 */

export type LogLevel = "info" | "warn" | "error";

export type LogEntry = {
  id: number;
  time: number;
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
};

const MAX_ENTRIES = 400;
const MAX_DATA_CHARS = 2000;

let entries: LogEntry[] = [];
let nextId = 1;
let devMode = false;
const listeners = new Set<(e: LogEntry[]) => void>();

export function setDevMode(on: boolean): void {
  devMode = on;
}

export function isDevMode(): boolean {
  return devMode;
}

const SECRET_KEY = /^(authorization|api[-_]?key|apikey|x-api-key|token|password|secret)$/i;

/** Replaces credential-shaped values and trims anything too long to be worth keeping. */
function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > MAX_DATA_CHARS ? `${value.slice(0, MAX_DATA_CHARS)}… (${value.length} chars)` : value;
  }
  if (typeof value !== "object") return value;
  if (depth > 4) return "…";
  if (Array.isArray(value)) {
    const head = value.slice(0, 40).map((v) => redact(v, depth + 1));
    return value.length > 40 ? [...head, `… ${value.length - 40} more`] : head;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? "<redacted>" : redact(v, depth + 1);
  }
  return out;
}

function push(level: LogLevel, scope: string, message: string, data?: unknown): void {
  const entry: LogEntry = {
    id: nextId++,
    time: Date.now(),
    level,
    scope,
    message,
    data: data === undefined ? undefined : redact(data),
  };
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry];
  if (devMode) {
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(`[enki:${scope}] ${message}`, entry.data ?? "");
  }
  for (const l of listeners) l(entries);
}

export const log = {
  info: (scope: string, message: string, data?: unknown) => push("info", scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => push("warn", scope, message, data),
  error: (scope: string, message: string, data?: unknown) => push("error", scope, message, data),
};

export function getLogs(): LogEntry[] {
  return entries;
}

export function clearLogs(): void {
  entries = [];
  for (const l of listeners) l(entries);
}

export function onLogs(cb: (e: LogEntry[]) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Plain-text dump for pasting into a bug report. */
export function formatLogs(): string {
  const stamp = (t: number) => new Date(t).toISOString().slice(11, 23);
  return entries
    .map((e) => {
      const head = `${stamp(e.time)} ${e.level.toUpperCase().padEnd(5)} [${e.scope}] ${e.message}`;
      if (e.data === undefined) return head;
      let body: string;
      try {
        body = JSON.stringify(e.data, null, 2);
      } catch {
        body = String(e.data);
      }
      return `${head}\n${body}`;
    })
    .join("\n");
}
