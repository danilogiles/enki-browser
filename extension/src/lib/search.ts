/**
 * AI search from the address bar (0.8.9). The search URL is Enki's own page
 * (chrome-extension://<id>/search.html?q=%s), so nothing passes through a server of ours.
 * Only the query leaves the computer, only to the user's provider or to DuckDuckGo (q only).
 */
import type { ChatRequest } from "./types";
import { DEFAULT_SETTINGS, presetOf, SETTINGS_KEY, type Settings } from "./settings";

export type SearchEngine = "enki" | "ddg";
export const SEARCH_ENGINE_KEY = "enki:searchEngine";
/** Enki Shield's extension id: the only extension allowed to read or change the setting. */
export const SHIELD_EXTENSION_ID = "aacambieennepbgemjkpailjdkldbjjf";

export function isSearchEngine(v: unknown): v is SearchEngine {
  return v === "enki" || v === "ddg";
}

/** "@enki q" / "@ddg q" choose the engine for one search; the prefix is removed. */
export function parseQuery(raw: string): { query: string; force?: SearchEngine } {
  const m = /^\s*@(enki|ddg)(?:\s+|$)([\s\S]*)$/i.exec(raw);
  if (!m) return { query: raw.trim() };
  return { query: m[2].trim(), force: m[1].toLowerCase() as SearchEngine };
}

/** DuckDuckGo with only `q`: no extra parameters. */
export function ddgUrl(query: string): string {
  return `https://duckduckgo.com/?${new URLSearchParams({ q: query }).toString()}`;
}

export type RouteInput = {
  engine: SearchEngine | undefined;
  force?: SearchEngine;
  incognito: boolean;
  hasModel: boolean;
  query: string;
};
/** Unset means DuckDuckGo: nothing changes until the user picks. */
export function decideRoute(i: RouteInput): "enki" | "ddg" {
  if (!i.query) return "ddg";
  if (i.incognito || !i.hasModel) return "ddg";
  const engine = i.force ?? i.engine;
  return engine === "enki" ? "enki" : "ddg";
}

export const SEARCH_SYSTEM =
  "You answer a search typed in the browser's address bar. Reply with a concise, well-structured Markdown answer. " +
  "You have no access to the user's tabs, pages, history or chats. Do not include images or raw HTML.";

/** Ask mode only: the query and nothing else. No tools, no page content, no history. */
export function buildSearchRequest(model: string, query: string, maxTokens: number, signal?: AbortSignal): ChatRequest {
  return {
    model,
    system: SEARCH_SYSTEM,
    messages: [{ role: "user", parts: [{ type: "text", text: query }] }],
    tools: [],
    maxTokens,
    signal,
  };
}

/** Auth or rate-limit failures send the user to DuckDuckGo instead of a dead end. */
export function isFallbackError(message: string): boolean {
  return /\b(401|403|429)\b|unauthori[sz]ed|invalid.*key|api key|rate.?limit|quota|too many requests/i.test(message);
}

/** Links in answers: http(s)/mailto only. Anything else (javascript:, data:, chrome:) is dropped. */
export function safeHref(href: string | undefined | null): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href);
    return ["http:", "https:", "mailto:"].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export async function getSearchEngine(): Promise<SearchEngine | undefined> {
  const v = (await chrome.storage.local.get(SEARCH_ENGINE_KEY))[SEARCH_ENGINE_KEY];
  return isSearchEngine(v) ? v : undefined;
}

export async function setSearchEngine(value: SearchEngine): Promise<void> {
  if (!isSearchEngine(value)) throw new Error("invalid search engine");
  await chrome.storage.local.set({ [SEARCH_ENGINE_KEY]: value });
}

/** Applies immediately in every open Enki page: both switches read the same key. */
export function onSearchEngineChange(cb: (v: SearchEngine | undefined) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && SEARCH_ENGINE_KEY in changes) {
      const v = changes[SEARCH_ENGINE_KEY].newValue;
      cb(isSearchEngine(v) ? v : undefined);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export type ExternalReply = { ok: true; value?: SearchEngine | null } | { ok: false; error: string };

/** Shield's switch talks to Enki through chrome.runtime.onMessageExternal. Only Shield, only these two messages. */
export async function handleExternalMessage(
  msg: unknown,
  sender: { id?: string },
  io: { get: () => Promise<SearchEngine | undefined>; set: (v: SearchEngine) => Promise<void> } = { get: getSearchEngine, set: setSearchEngine },
): Promise<ExternalReply> {
  if (sender?.id !== SHIELD_EXTENSION_ID) return { ok: false, error: "forbidden" };
  const m = msg as { type?: unknown; value?: unknown } | null;
  if (m?.type === "enki:getSearchEngine") return { ok: true, value: (await io.get()) ?? null };
  if (m?.type === "enki:setSearchEngine") {
    if (!isSearchEngine(m.value)) return { ok: false, error: "invalid value" };
    await io.set(m.value);
    return { ok: true };
  }
  return { ok: false, error: "unknown message" };
}

/** Whether a model is set up, from stored settings as they are (no decryption needed to tell). */
export function storedHasModel(raw: Partial<Settings> | undefined): boolean {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  const preset = presetOf(s.preset);
  const key = raw?.apiKeys?.[s.preset] ?? raw?.apiKey ?? "";
  return !!(s.askModel || s.model).trim() && (!!key || !!preset.keyOptional);
}

/**
 * The first thing search.html runs, before React or any provider code loads. Unset and "ddg"
 * (most people) leave at once with location.replace: no history entry, no network, nothing drawn.
 * Returns the query when the page should answer with Enki.
 */
export async function earlyRoute(env: {
  href: string;
  incognito: boolean;
  storageGet: (keys: string[]) => Promise<Record<string, unknown>>;
  replace: (url: string) => void;
}): Promise<{ route: "enki" | "ddg"; query: string; force?: SearchEngine }> {
  const { query, force } = parseQuery(new URL(env.href).searchParams.get("q") ?? "");
  const stored = await env.storageGet([SEARCH_ENGINE_KEY, SETTINGS_KEY]);
  const engine = isSearchEngine(stored[SEARCH_ENGINE_KEY]) ? stored[SEARCH_ENGINE_KEY] : undefined;
  const route = decideRoute({
    engine, force, query, incognito: env.incognito,
    hasModel: storedHasModel(stored[SETTINGS_KEY] as Partial<Settings> | undefined),
  });
  if (route === "ddg") env.replace(ddgUrl(query));
  return { route, query, force };
}
