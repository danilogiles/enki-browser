/**
 * Recovers tool calls that a model wrote as plain text instead of emitting properly.
 *
 * Some gateways route to providers that ignore the OpenAI `tools` parameter — notably free
 * pools backed by other agent harnesses. Those models either announce they have no tools, or
 * print a call in whatever syntax their own harness uses. When the call names one of *our*
 * tools we can honour it; when it names somebody else's (`mcp__puppeteer_core__…`) we must not,
 * so foreign names are reported to the user instead of executed.
 */
import type { ToolCallPart } from "../types";

export type TextToolCalls = {
  /** Calls that named a real Enki tool and can be executed. */
  calls: ToolCallPart[];
  /** The text with any recovered call syntax removed. */
  cleaned: string;
  /** Tool names from another system, which are never executed. */
  foreign: string[];
};

/** The model saying, in so many words, that it was given no tools. */
export const CLAIMS_NO_TOOLS =
  /\b(?:no tools (?:are )?available|i (?:don'?t|do not) have (?:any |the )?(?:tools|ability to navigate)|not have tools|n[ãa]o tenho (?:as )?ferramentas|sem ferramentas dispon[íi]veis|n[ãa]o disponho de ferramentas|no dispongo de herramientas|no tengo herramientas)\b/i;

/** Call syntax belonging to another harness. */
const FOREIGN_NAME = /\b(mcp__[A-Za-z0-9_]+|functions\.[A-Za-z0-9_]+|browser_[a-z_]+|puppeteer_[a-z_]+)\b/g;

let counter = 0;

export function extractTextToolCalls(text: string, allowed: Set<string>): TextToolCalls {
  const calls: ToolCallPart[] = [];
  const foreign = new Set<string>();
  let cleaned = text;

  for (const { json, start, end } of findJsonObjects(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    for (const candidate of flatten(parsed)) {
      const name = candidate.name;
      if (!name) continue;
      if (!allowed.has(name)) {
        if (FOREIGN_NAME.test(name) || name.includes("__")) foreign.add(name);
        continue;
      }
      calls.push({
        type: "tool_call",
        id: `text_${Date.now().toString(36)}_${counter++}`,
        name,
        input: candidate.args,
      });
      cleaned = cleaned.slice(0, start) + " ".repeat(end - start) + cleaned.slice(end);
    }
  }

  for (const m of text.matchAll(FOREIGN_NAME)) if (!allowed.has(m[1])) foreign.add(m[1]);

  // Remove the wrappers the JSON was sitting inside, or their empty shells stay on screen.
  cleaned = cleaned
    .replace(/<\/?(?:tool_call|tool_use|function_call|invoke|antml:invoke)[^>]*>/gi, "")
    .replace(/```(?:json|tool_code|xml|tool_call)?\s*```/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { calls, cleaned, foreign: [...foreign] };
}

/** Pulls `{name, args}` out of the several shapes harnesses use. */
function flatten(value: unknown): Array<{ name?: string; args: Record<string, unknown> }> {
  if (!value || typeof value !== "object") return [];
  const v = value as Record<string, unknown>;

  if (Array.isArray(v.tool_calls)) return v.tool_calls.flatMap((c) => flatten(c));
  if (v.function && typeof v.function === "object") return flatten(v.function);

  const name = typeof v.name === "string" ? v.name : undefined;
  if (!name) return [];
  const raw = v.arguments ?? v.parameters ?? v.input ?? v.args ?? {};
  let args: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === "object") args = p as Record<string, unknown>;
    } catch {
      /* leave empty */
    }
  } else if (raw && typeof raw === "object") {
    args = raw as Record<string, unknown>;
  }
  return [{ name, args }];
}

/** Locates balanced top-level JSON objects, ignoring braces inside strings. */
function findJsonObjects(text: string): Array<{ json: string; start: number; end: number }> {
  const found: Array<{ json: string; start: number; end: number }> = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        found.push({ json: text.slice(start, i + 1), start, end: i + 1 });
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return found;
}
