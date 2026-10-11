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

/** The two buttons on a failed answer: DuckDuckGo (only q, a normal navigation) or the same query again. */
export function searchErrorActions(query: string, io: { assign: (url: string) => void; rerun: (query: string) => void }) {
  return {
    ddgHref: ddgUrl(query),
    searchDdg: () => io.assign(ddgUrl(query)),
    tryAgain: () => io.rerun(query),
  };
}

export type ProviderErrorView = { kind: "limit" | "auth" | "network" | "other"; text: string; code?: string };

/**
 * What the error notice shows. Never the provider's own text: error bodies can echo keys, URLs or
 * the prompt. Only a fixed sentence and, when present, the bare HTTP status code.
 */
export function describeProviderError(raw: string): ProviderErrorView {
  const code = /\b([45]\d\d)\b/.exec(raw)?.[1];
  if (code === "429" || /rate.?limit|quota|too many requests/i.test(raw))
    return { kind: "limit", code, text: "Your AI provider's limit was reached. Try again later or search on DuckDuckGo." };
  if (code === "401" || code === "403" || /unauthori[sz]ed|forbidden|invalid.*key|api key/i.test(raw))
    return { kind: "auth", code, text: "Your API key was rejected. Check it in Settings." };
  if (/failed to fetch|networkerror|network error|econnrefused|timed? ?out|load failed/i.test(raw))
    return { kind: "network", text: "Couldn't reach your AI provider. Check your connection." };
  return { kind: "other", code, text: "Something went wrong with your AI provider." };
}

export type EnkiChoiceResult = "enabled" | "needs-incognito" | "no-shield";
export type ShieldStatus = { allowed: boolean; searchSetupDone: boolean };

/**
 * Asks Shield whether it may run in incognito and whether Enki is the default search. Only those
 * two booleans are read; a missing searchSetupDone counts as false; anything else (no reply, an
 * error, a non-boolean) means Shield is not there.
 */
export async function queryShieldStatus(send: (extensionId: string, msg: unknown) => Promise<unknown>): Promise<ShieldStatus | null> {
  let reply: unknown;
  try {
    reply = await send(SHIELD_EXTENSION_ID, { type: "shield:incognitoAllowed" });
  } catch {
    return null;
  }
  if (!reply || typeof reply !== "object") return null;
  const { allowed, searchSetupDone } = reply as { allowed?: unknown; searchSetupDone?: unknown };
  if (typeof allowed !== "boolean") return null;
  if (searchSetupDone !== undefined && typeof searchSetupDone !== "boolean") return null;
  return { allowed, searchSetupDone: searchSetupDone ?? false };
}

/**
 * Choosing "Enki AI" in the panel. Private windows must keep searching with DuckDuckGo, and that is
 * Shield's job there, so Enki AI is only saved once Shield confirms it may run in incognito.
 * Default-search setup is guidance only and never blocks saving. (Shield's own switch has already
 * checked this.)
 */
export async function chooseEnkiEngine(io: {
  send: (extensionId: string, msg: unknown) => Promise<unknown>;
  set: (v: SearchEngine) => Promise<void>;
}): Promise<{ result: EnkiChoiceResult; status: ShieldStatus | null }> {
  const status = await queryShieldStatus(io.send);
  if (!status) return { result: "no-shield", status };
  if (!status.allowed) return { result: "needs-incognito", status };
  await io.set("enki");
  return { result: "enabled", status };
}

export const SHIELD_EXTENSIONS_PAGE = `chrome://extensions/?id=${SHIELD_EXTENSION_ID}`;

/** The search URL people add in chrome://settings/searchEngines: Shield's page, which hands off to Enki. */
export const SHIELD_SEARCH_URL = `chrome-extension://${SHIELD_EXTENSION_ID}/search.html?q=%s`;
export const SEARCH_ENGINES_PAGE = "chrome://settings/searchEngines";
