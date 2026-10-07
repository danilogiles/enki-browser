import { getLogs } from "./debug";
import type { Settings } from "./settings";

/** Allowlist structural metadata; arbitrary error strings can contain keys, prompts or page text. */
export function diagnosticReport(settings: Settings): string {
  const numeric = new Set(["messages", "tools", "requestBytes", "idleTimeoutMs", "chunks", "historyMessages", "contextChars", "freedChars", "inputTokens", "outputTokens"]);
  // A few fixed-vocabulary strings are worth far more than they risk in a bug report. Each is
  // still shape-checked, so a provider echoing something unexpected into them cannot leak it.
  const enums = new Set(["finishReason", "contentType", "phase", "stopReason"]);
  const enumLike = /^[w./+-]{1,40}$/;
  return JSON.stringify({
    version: chrome.runtime.getManifest().version, generatedAt: new Date().toISOString(),
    provider: settings.preset, model: settings.model, timeoutSeconds: settings.requestTimeoutSec,
    contextBudgetTokens: settings.contextBudgetTokens,
    events: getLogs().slice(-100).map((e) => {
      const data = e.data && typeof e.data === "object" ? Object.fromEntries(Object.entries(e.data)
        .filter(([k, v]) => (numeric.has(k) && typeof v === "number")
          || (enums.has(k) && typeof v === "string" && enumLike.test(v)))) : undefined;
      const category = e.level === "error" ? (/HTTP (\d{3})/.exec(e.message)?.[0] ?? "request_or_tool_error")
        : /Stream ended/.test(e.message) ? "stream_finished"
        : /First chunk/.test(e.message) ? "first_chunk"
        : /POST |Anthropic /.test(e.message) ? "request_started" : e.level;
      return { time: new Date(e.time).toISOString(), scope: e.scope, category, data };
    }),
    privacy: "No keys, URLs, page content, prompts, tool arguments or raw error messages included.",
    note: "The in-panel Logs view is not redacted this way and can contain page data.",
  }, null, 2);
}
