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
