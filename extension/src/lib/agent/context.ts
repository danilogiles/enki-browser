/**
 * Keeps the conversation anchored to the browser's *current* state.
 *
 * Page observations are snapshots of a moment. Left in the transcript they pile up — several
 * thousand tokens each — and, worse, they contradict each other: by the third turn the model is
 * looking at three different versions of "the page" and can answer from a stale one or believe
 * it is somewhere it no longer is. This is the usual cause of a browser agent that works on the
 * first request and drifts afterwards.
 *
 * So before each request we collapse superseded observations to a short marker and strip stale
 * tab headers and screenshots from older turns, leaving exactly one authoritative view of the
 * browser: the newest one. The text of the conversation itself is never touched.
 */
import type { Message, TextPart, ToolMessage, UserMessage } from "../types";

/** Tools whose output describes the page as it was at one instant. */
const OBSERVATION_TOOLS = new Set(["read_page", "find", "get_page_text", "screenshot"]);

const STALE_MARK = "[superseded]";

export type CompactionStats = { observations: number; screenshots: number; headers: number };

/**
 * Rewrites `history` in place so only the most recent observations survive.
 * `keepLatest` is how many observation results to leave intact, newest first.
 */
export function compactHistory(history: Message[], keepLatest = 2): CompactionStats {
  const stats: CompactionStats = { observations: 0, screenshots: 0, headers: 0 };

  // --- 1. Collapse superseded tool observations -------------------------------------------
  const observationTurns: number[] = [];
  history.forEach((m, i) => {
    if (m.role === "tool" && m.parts.some((p) => OBSERVATION_TOOLS.has(p.name))) observationTurns.push(i);
  });
  for (const i of observationTurns.slice(0, Math.max(0, observationTurns.length - keepLatest))) {
    const message = history[i] as ToolMessage;
    message.parts = message.parts.map((part) => {
      if (!OBSERVATION_TOOLS.has(part.name)) return part;
      const first = part.content[0];
      if (part.content.length === 1 && first?.type === "text" && first.text.startsWith(STALE_MARK)) return part;
      stats.observations++;
      return {
        ...part,
        content: [
          {
            type: "text",
            text: `${STALE_MARK} ${part.name} ran here and its output described the page at that moment. It has been removed because the page has moved on since. Call ${part.name} again if you need the current state.`,
          },
        ],
      };
    });
  }

  // --- 2. Keep one live tab header and one screenshot -------------------------------------
  const userTurns = history.flatMap((m, i) => (m.role === "user" ? [i] : []));
  const newest = userTurns[userTurns.length - 1];
  for (const i of userTurns) {
    if (i === newest) continue;
    const message = history[i] as UserMessage;
    message.parts = message.parts.flatMap((part) => {
      if (part.type === "image") {
        stats.screenshots++;
        return [{ type: "text", text: "[earlier screenshot removed]" } as TextPart];
      }
      const stripped = part.text.replace(/^\[(?:Current tab|No active tab)\][^\n]*\n\n?/, "");
      if (stripped !== part.text) stats.headers++;
      return [{ ...part, text: stripped }];
    });
  }

  return stats;
}

/** Rough character count of what would be sent, for logging. */
export function historySize(history: Message[]): number {
  let chars = 0;
  for (const m of history) {
    for (const part of m.parts) {
      if (part.type === "text") chars += part.text.length;
      else if (part.type === "image") chars += part.data.length;
      else if (part.type === "tool_call") chars += JSON.stringify(part.input).length;
      else if (part.type === "tool_result") {
        for (const c of part.content) chars += c.type === "text" ? c.text.length : c.data.length;
      }
    }
  }
  return chars;
}

/** Restored and resumed conversations must not reuse page refs from a previous document. */
export function invalidateObservations(history: Message[]): void {
  compactHistory(history, 0);
  for (const m of history) {
    if (m.role === "user") m.parts = m.parts.filter((p) => p.type !== "image");
  }
}

const SUMMARY = "[Conversation summary, historical context only]\n";

/** Conservative estimate, with a fixed image allowance rather than base64 character count. */
export function estimateTokens(history: Message[]): number {
  const text = JSON.stringify(history, (key, value) => key === "data" ? "[image]" : value);
  const images = history.reduce((n, m) => n + m.parts.filter((p) => p.type === "image").length, 0);
  const toolImages = history.flatMap((m) => m.role === "tool" ? m.parts : [])
    .flatMap((p) => p.content).filter((p) => p.type === "image").length;
  return Math.ceil(text.length / 3) + (images + toolImages) * 2000;
}

/** Summarize complete exchanges only; never split a tool call from its results. No extra API call. */
export function budgetHistory(history: Message[], budgetTokens: number): number {
  let removed = 0;
  let summary = "";
  if (history[0]?.role === "user" && history[0].parts[0]?.type === "text" && history[0].parts[0].text.startsWith(SUMMARY)) {
    summary = history.shift()!.parts.filter((p) => p.type === "text").map((p) => (p as TextPart).text).join("\n").slice(SUMMARY.length);
  }
  // Characters, not tokens (~3 chars per token), so the summary can never crowd out the live
  // exchange it is meant to make room for.
  const summaryChars = Math.min(6000, budgetTokens);
  // Track the estimate incrementally: re-stringifying the whole history on every pass is
  // quadratic, and the budget can be set as high as 200k.
  let tokens = estimateTokens(history);
  while (tokens + Math.ceil(summary.length / 3) > budgetTokens) {
    const next = history.findIndex((m, i) => i > 0 && m.role === "user");
    if (next < 0) break;
    const old = history.splice(0, next);
    tokens -= estimateTokens(old);
    const lines = old.flatMap((m) => m.parts.map((p) => {
      if (p.type === "text") return `${m.role}: ${p.text.slice(0, 500)}`;
      if (p.type === "tool_result") return `${p.name}: ${p.isError ? "failed" : "tool reported success"}`;
      return "";
    })).filter(Boolean);
    summary = `${summary}\n${lines.join("\n")}`.slice(-summaryChars);
    removed += old.length;
  }
  if (summary) history.unshift({ role: "user", parts: [{ type: "text", text: SUMMARY + summary }] });
  return removed;
}

/** A panel can close after a tool call but before its result. Preserve valid provider history. */
export function repairInterruptedHistory(history: Message[]): void {
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m.role !== "assistant") continue;
    const calls = m.parts.filter((p) => p.type === "tool_call");
    if (!calls.length) continue;
    let next = history[i + 1];
    if (next?.role !== "tool") {
      next = { role: "tool", parts: [] };
      history.splice(i + 1, 0, next);
    }
    for (const call of calls) {
      if (!next.parts.some((r) => r.toolCallId === call.id)) next.parts.push({
        type: "tool_result", toolCallId: call.id, name: call.name, isError: true,
        content: [{ type: "text", text: "Interrupted. Outcome unknown. Inspect the page before deciding whether anything remains to do; do not replay this action automatically." }],
      });
    }
  }
}
