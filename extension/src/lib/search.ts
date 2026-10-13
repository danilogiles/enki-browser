/**
 * AI search from the address bar (0.8.9). The search URL is Enki's own page
 * (chrome-extension://<id>/search.html?q=%s), so nothing passes through a server of ours.
 * Only the query leaves the computer, only to the user's provider or to DuckDuckGo (q only).
 */
import type { ChatRequest } from "./types";
import { DEFAULT_SETTINGS, presetOf, SETTINGS_KEY, type Settings } from "./settings";

/** "other": the user keeps (or picks) another engine in Chromium's own settings. For search.html it
 *  behaves exactly like DuckDuckGo: no AI call, the query goes to DuckDuckGo with only q. */
export type SearchEngine = "enki" | "ddg" | "other";
export const SEARCH_ENGINE_KEY = "enki:searchEngine";
/** Enki Shield's extension id: the only extension allowed to read or change the setting. */
export const SHIELD_EXTENSION_ID = "aacambieennepbgemjkpailjdkldbjjf";

export function isSearchEngine(v: unknown): v is SearchEngine {
  return v === "enki" || v === "ddg" || v === "other";
}

/** "@enki q" / "@ddg q" choose the engine for one search; the prefix is removed. */
export function parseQuery(raw: string): { query: string; force?: "enki" | "ddg" } {
  const m = /^\s*@(enki|ddg)(?:\s+|$)([\s\S]*)$/i.exec(raw);
  if (!m) return { query: raw.trim() };
  return { query: m[2].trim(), force: m[1].toLowerCase() as "enki" | "ddg" };
}

/** DuckDuckGo with only `q`: no extra parameters. */
export function ddgUrl(query: string): string {
  return `https://duckduckgo.com/?${new URLSearchParams({ q: query }).toString()}`;
}

export type RouteInput = {
  engine: SearchEngine | undefined;
  force?: "enki" | "ddg";
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
}): Promise<{ route: "enki" | "ddg"; query: string; force?: "enki" | "ddg" }> {
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

/** The user asked for Enki AI but setup is not finished. An intent flag only: no query data. */
export const SETUP_PENDING_KEY = "enki:searchSetupPending";

export type SetupIO = {
  setEngine: (v: SearchEngine) => Promise<void>;
  getPending: () => Promise<boolean>;
  setPending: (v: boolean) => Promise<void>;
};

export const storageSetupIO: SetupIO = {
  setEngine: setSearchEngine,
  getPending: async () => (await chrome.storage.local.get(SETUP_PENDING_KEY))[SETUP_PENDING_KEY] === true,
  setPending: async (v) => { if (v) await chrome.storage.local.set({ [SETUP_PENDING_KEY]: true }); else await chrome.storage.local.remove(SETUP_PENDING_KEY); },
};

export const setupComplete = (s: ShieldStatus | null | undefined): boolean => !!s && s.allowed && s.searchSetupDone;

/**
 * The selector shows what the address bar really does: "enki" is saved only once Shield confirms
 * both incognito access and the default-search setup. Until then the choice is remembered as
 * pending and the engine stays DuckDuckGo.
 */
export async function chooseEnkiEngine(io: SetupIO & { send: (extensionId: string, msg: unknown) => Promise<unknown>; hasModel?: boolean }): Promise<{ result: "enabled" | "pending" | "no-shield"; status: ShieldStatus | null }> {
  const status = await queryShieldStatus(io.send);
  if (!status) return { result: "no-shield", status };
  // Without a model Enki AI is never enabled: the choice stays pending and the setup opens.
  if (setupComplete(status) && io.hasModel !== false) {
    await io.setEngine("enki");
    await io.setPending(false);
    return { result: "enabled", status };
  }
  await io.setPending(true);
  await io.setEngine("ddg");
  return { result: "pending", status };
}

/** Picking DuckDuckGo drops any pending Enki request. */
export async function chooseDdgEngine(io: SetupIO): Promise<void> {
  await io.setEngine("ddg");
  await io.setPending(false);
}

/** "Other search engine": nothing opens and nothing is sent; search.html behaves like DuckDuckGo. */
export async function chooseOtherEngine(io: SetupIO): Promise<void> {
  await io.setEngine("other");
  await io.setPending(false);
}

/** The three options of the "Search engine" setting (0.8.10, Ink's text reviewed by Cloak). */
export const SEARCH_OPTION_TEXT = {
  ddg: "Searches go to DuckDuckGo, under its privacy policy. Enki doesn't see them.",
  other: "Searches go straight to that engine, under its own privacy policy. Enki doesn't see them.",
  otherHowTo: "Enki can't change this for you. Open Chromium's search engine settings, find the engine you want, then choose ⋮\u00a0›\u00a0Make\u00a0default.",
  otherIcons: "This Chromium page loads icons for other search engines when it opens.",
  needsModel: "Needs a model set up in Settings.",
  enkiScope: "Only what you type is sent, not your tabs or history. Your provider may search the web to answer.",
} as const;

/** Enki AI's line (Ink's mocks 02/04): provider + what is sent; without a model it also asks for one. */
export function enkiOptionText(provider: string | undefined, hasModel: boolean): string {
  // No model means no provider yet: the "(provider · Ask)" part is left out (Ink, mock 04 review).
  if (!hasModel || !provider) return `Searches go to your AI provider. ${SEARCH_OPTION_TEXT.enkiScope} ${SEARCH_OPTION_TEXT.needsModel}`;
  return `Searches go to your AI provider (${provider} · Ask). ${SEARCH_OPTION_TEXT.enkiScope}`;
}

/** Short name of the selected provider for the option text: "Ollama (local)" → "Ollama". */
export function providerShortName(raw: Partial<Settings> | undefined): string | undefined {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  return presetOf(s.preset).label.split(" (")[0].trim() || undefined;
}

/**
 * Run on every fresh Shield reply (Settings opened or refocused). Finishes a pending request once
 * both steps are done, and pauses Enki AI (back to DuckDuckGo, request kept pending) when incognito
 * access was taken away or Shield stopped answering.
 */
export async function reconcileSearchSetup(
  status: ShieldStatus | null,
  engine: SearchEngine | undefined,
  io: SetupIO,
  hasModel = true,
): Promise<"enabled" | "paused" | "unchanged"> {
  if (engine === "enki") {
    if (status && status.allowed) return "unchanged";
    await io.setEngine("ddg");
    await io.setPending(true);
    return "paused";
  }
  if (hasModel && setupComplete(status) && (await io.getPending())) {
    await io.setEngine("enki");
    await io.setPending(false);
    return "enabled";
  }
  return "unchanged";
}

export const SHIELD_EXTENSIONS_PAGE = `chrome://extensions/?id=${SHIELD_EXTENSION_ID}`;

/** The search URL people add in chrome://settings/searchEngines: Shield's page, which hands off to Enki. */
export const SHIELD_SEARCH_URL = `chrome-extension://${SHIELD_EXTENSION_ID}/search.html?q=%s`;
export const SEARCH_ENGINES_PAGE = "chrome://settings/searchEngines";

/** One-shot: set when Shield's first search finished the setup; search.html shows a note once. */
export const JUST_SET_UP_KEY = "enki:searchJustSetUp";

export type ExternalReply = { ok: true; value?: SearchEngine | null } | { ok: false; error: string };
export type ExternalIO = SetupIO & {
  get: () => Promise<SearchEngine | undefined>;
  setJustSetUp: () => Promise<void>;
};

export const storageExternalIO: ExternalIO = {
  ...storageSetupIO,
  get: getSearchEngine,
  setJustSetUp: async () => { await chrome.storage.local.set({ [JUST_SET_UP_KEY]: true }); },
};

/**
 * Shield talks to Enki through chrome.runtime.onMessageExternal. Only Shield, only two messages:
 * - {type:"enki:getSearchEngine", incognitoAllowed?: boolean}: the current engine. When Shield
 *   reports incognito access and Enki AI is pending, the first search finishes the setup.
 * - {type:"enki:setSearchEngine", value:"enki"|"ddg"}: Shield's own switch (already checked).
 */
export async function handleExternalMessage(msg: unknown, sender: { id?: string }, io: ExternalIO = storageExternalIO): Promise<ExternalReply> {
  if (sender?.id !== SHIELD_EXTENSION_ID) return { ok: false, error: "forbidden" };
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { ok: false, error: "unknown message" };
  const m = msg as Record<string, unknown>;
  if (m.type === "enki:getSearchEngine") {
    const extra = Object.keys(m).filter((k) => k !== "type" && k !== "incognitoAllowed");
    if (extra.length || ("incognitoAllowed" in m && typeof m.incognitoAllowed !== "boolean")) return { ok: false, error: "invalid message" };
    if (m.incognitoAllowed === true && (await io.getPending())) {
      await io.setEngine("enki");
      await io.setPending(false);
      await io.setJustSetUp();
      return { ok: true, value: "enki" };
    }
    // Shield only knows enki|ddg; "other" behaves like DuckDuckGo, so it is reported as ddg.
    const cur = await io.get();
    return { ok: true, value: cur === "other" ? "ddg" : cur ?? null };
  }
  if (m.type === "enki:setSearchEngine") {
    if (m.value !== "enki" && m.value !== "ddg") return { ok: false, error: "invalid value" };
    await io.setEngine(m.value);
    return { ok: true };
  }
  return { ok: false, error: "unknown message" };
}

/** search.html, routed to Enki: true once after setup finished, then cleared. */
export async function takeJustSetUp(io: { get: () => Promise<unknown>; clear: () => Promise<void> }): Promise<boolean> {
  if ((await io.get()) !== true) return false;
  await io.clear();
  return true;
}
