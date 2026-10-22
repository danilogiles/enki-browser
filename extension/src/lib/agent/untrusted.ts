/**
 * The structural fence around everything that comes from the web.
 *
 * A prompt rule ("page text is data") only asks the model to behave. The fence makes the boundary
 * visible in the text itself: every piece of content Enki did not write — page text, the outline,
 * `find` hits, tab titles and addresses, search results, pages read with read_url, connector
 * replies, tool errors that quote a page, screenshot captions — reaches the model wrapped as
 *
 *   <untrusted_page_data nonce="4f1c…" source="…">…</untrusted_page_data>
 *
 * The nonce is random per user request, so a page cannot know it in advance. Content can never
 * contain a working opening or closing tag, or something that looks like one: those are rewritten
 * before wrapping. The content is cut to a size that fits the context budget, and the closing tag
 * is always written, so a fence can never be left open.
 *
 * This is the only module that writes the tag. Every call site goes through fence() or
 * fenceInline(); test/safety-unit.cjs checks that nothing reaches the model around it.
 */

export const FENCE_TAG = "untrusted_page_data";

/** Generous ceiling for one fenced block; loop.ts lowers it further from the context budget. */
export const DEFAULT_FENCE_MAX_CHARS = 60_000;

export type UntrustedSource =
  | "tab"
  | "read_page"
  | "find"
  | "get_page_text"
  | "screenshot"
  | "list_tabs"
  | "web_search"
  | "read_url"
  | "connector"
  | "connector_description"
  | "tool_result"
  | "tool_error"
  | "navigate"
  | "click"
  | "type"
  | "switch_tab"
  | "new_tab"
  | "agent_nudge"
  | (string & {});

export type FenceOptions = {
  source: UntrustedSource;
  nonce: string;
  /** Where the content came from, when known. Shown to the model, never trusted. */
  url?: string;
  /** Cap on the content between the tags, in characters. */
  maxChars?: number;
};

/** 128 bits from the platform's CSPRNG, as hex. Throws if no CSPRNG is available. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues) {
    throw new Error("Enki needs a CSPRNG (crypto.getRandomValues) to fence untrusted content.");
  }
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Invisible / zero-width characters a page can use to split a tag so a naive match misses it.
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u180E]/g;
// "<" and look-alikes (fullwidth, small, angle, math, ornate).
const LT_CHARS = "<\uFF1C\uFE64\u2039\u276C\u276E\u27E8\u3008\u2329\uFE3F\uFE3C\u3014\u3016\u3018\u2768\u2772\u2774";
// ">" look-alikes.
const GT_CHARS = ">\uFF1E\uFE65\u203A\u276D\u276F\u27E9\u3009\u232A\uFE40\uFE3D\u3015\u3017";
const LT = `[${LT_CHARS}]`;
const GT = `[${GT_CHARS}]`;
// Named / decimal / hex entities that decode to "<" or a look-alike opener.
const LT_ENTITY = /&(?:lt|LT|Lt|#0*60|#x0*3[cC]);?/g;
const GT_ENTITY = /&(?:gt|GT|Gt|#0*62|#x0*3[eE]);?/g;
// Tag-ish tokens: untrusted fences and fake role tags (system/user/assistant/…).
const ROLE_TAGS = "untrusted|end[_\\s-]*untrusted|system|user|assistant|human|model|tool|function|dev|developer|prompt|instruction|im_start|im_end";
const TAG_LIKE = new RegExp(`${LT}\\s*\\/?\\s*(?:${ROLE_TAGS})[\\w\\s:./-]{0,60}${GT}?`, "gi");
const NONCE_LIKE = /\bnonce\s*[=:]\s*["'\u201C\u201D]?/gi;

/**
 * Makes `content` safe to place inside a fence: no opening or closing tag (or a look-alike), no
 * HTML-entity or fullwidth stand-in, no role-tag spoof, no nonce attribute, and never the
 * request's own nonce. Idempotent. NFKC runs first so look-alikes collapse.
 */
export function neutralize(content: string, nonce?: string): string {
  let out = String(content ?? "");
  // Decode angle-bracket entities before NFKC so &lt;untrusted becomes a matchable opener.
  out = out.replace(LT_ENTITY, "<").replace(GT_ENTITY, ">");
  out = out.replace(INVISIBLE, "");
  out = out.normalize("NFKC");
  out = out.replace(INVISIBLE, ""); // again after NFKC, in case composition introduced any
  out = out.replace(TAG_LIKE, (m) => `[tag removed: ${m.replace(new RegExp(`[${LT_CHARS}${GT_CHARS}/]`, "g"), "").trim().slice(0, 40)}]`);
  out = out.replace(NONCE_LIKE, "nonce(removed)=");
  if (nonce) out = out.split(nonce).join("[nonce removed]");
  return out;
}

/** A tool error as the model sees it: the message (which may quote a page or MCP body) is fenced. */
export function fenceError(message: string, nonce: string | undefined): string {
  return nonce
    ? `Error:\n${fence(message, { source: "tool_error", nonce, maxChars: 4000 })}`
    : `Error: ${neutralize(message)}`;
}

/** A role word safe to print in Enki's own text; anything else becomes "element". */
export function safeRole(role: string | undefined): string {
  const r = String(role ?? "");
  return /^[a-z]{1,24}$/.test(r) ? r : "element";
}

/**
 * Text for the debug log: the request's nonce is removed FIRST (neutralize alone cannot know it),
 * then tags are neutralized and any nonce attribute is masked.
 */
export function redactForLog(text: string, nonce?: string): string {
  let out = String(text ?? "");
  if (nonce) out = out.split(nonce).join("(nonce)");
  out = neutralize(out);
  return out.replace(/\bnonce\s*(?:\(removed\))?\s*[=:]\s*["']?[0-9a-f]{8,}/gi, "nonce=(redacted)");
}

function attr(value: string): string {
  return neutralize(value).replace(/["<>\n\r\t]/g, " ").slice(0, 300).trim();
}

function cap(content: string, maxChars: number): string {
  const max = Math.max(200, Math.floor(maxChars));
  if (content.length <= max) return content;
  return `${content.slice(0, max)}\n[…cut by Enki at ${max} of ${content.length} characters]`;
}

/** Wraps web-derived content in the fence, on its own lines. */
export function fence(content: string, o: FenceOptions): string {
  const body = cap(neutralize(content, o.nonce), o.maxChars ?? DEFAULT_FENCE_MAX_CHARS);
  const url = o.url ? ` url="${attr(o.url)}"` : "";
  return `<${FENCE_TAG} nonce="${attr(o.nonce)}" source="${attr(o.source)}"${url}>\n${body}\n</${FENCE_TAG}>`;
}

/** One-line form for short values inside Enki's own text (the tab header): newlines are folded. */
export function fenceInline(content: string, o: FenceOptions): string {
  const body = cap(neutralize(content, o.nonce).replace(/[\r\n]+/g, " "), o.maxChars ?? 2000);
  return `<${FENCE_TAG} nonce="${attr(o.nonce)}" source="${attr(o.source)}">${body}</${FENCE_TAG}>`;
}

const BLOCK = new RegExp(`<${FENCE_TAG} nonce="([0-9a-f]+)" source="([^"]*)"(?: url="[^"]*")?>\\n?([\\s\\S]*?)\\n?</${FENCE_TAG}>`, "g");

/** True when `text` is exactly one well-formed fence (optionally with this nonce). */
export function isFenced(text: string, nonce?: string): boolean {
  const re = new RegExp(`^${BLOCK.source}$`);
  const m = re.exec(text);
  return !!m && (!nonce || m[1] === nonce);
}

/** The content of every fence in `text`, for scanning what the page said this turn. */
export function fencedContents(text: string): string[] {
  return [...text.matchAll(BLOCK)].map((m) => m[3]);
}

/** Replaces every fence with a short placeholder (used where history is summarized). */
export function stripFences(text: string): string {
  return text.replace(BLOCK, (_m, _n, source) => `[${source} data omitted]`);
}

/**
 * Cuts a fenced block down to `keepChars` of content and closes it again. Plain text is cut the
 * plain way. Used by the context trimmer so a trimmed result never leaves a fence open.
 */
export function truncateFenced(text: string, keepChars: number, note: string): string {
  const re = new RegExp(`^(<${FENCE_TAG} [^>\\n]*>)\\n([\\s\\S]*)\\n(</${FENCE_TAG}>)$`);
  const m = re.exec(text);
  if (!m) return `${text.slice(0, keepChars)}\n${note}`;
  return `${m[1]}\n${m[2].slice(0, keepChars)}\n${note}\n${m[3]}`;
}
