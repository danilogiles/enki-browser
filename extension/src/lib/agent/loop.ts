import type {
  ChatProvider,
  Message,
  StopReason,
  TextPart,
  ToolCallPart,
  ToolDefinition,
  ToolResultPart,
} from "../types";
import type { BrowserExecutor, ConfirmPayload, OtherWindowStop, ToolOutput } from "../tools/executor";
import { log } from "../debug";
import { budgetHistory, trimToolResults, compactHistory, estimateTokens, historySize } from "./context";
import { CLAIMS_NO_TOOLS, extractTextToolCalls } from "./toolcall-text";
import { confirmDecision } from "./actions";
import { fence, fenceError, neutralize, redactForLog } from "./untrusted";

export type AgentEvent =
  | { type: "status"; message: string; step: number; model?: string }
  | { type: "summary"; outcome: "finished" | "needs_input" | "incomplete"; succeeded: number; failed: number; reason: string }
  | { type: "assistant_start" }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  /** The turn produced only reasoning: show it as the answer instead of hiding it. */
  | { type: "promote_thinking" }
  /** Drop the text streamed so far — it claimed something that never happened. */
  | { type: "retract_text" }
  /** Something worth telling the user that is not an error. */
  | { type: "notice"; message: string }
  | { type: "tool_start"; call: ToolCallPart; label: string; sensitive: boolean }
  | { type: "approval_request"; call: ToolCallPart; label: string; confirm?: ConfirmPayload }
  /** The step targets a tab in another window: the card shows it with Cancel only, then the run ends. */
  | { type: "other_window"; call: ToolCallPart; stop: OtherWindowStop }
  | { type: "tool_result"; call: ToolCallPart; result: ToolResultPart; declined?: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; reason: StopReason | "max_steps" | "aborted" | "empty" | "repeated_failure" | "other_window" }
  | { type: "error"; message: string };

export type RunOptions = {
  provider: ChatProvider;
  model: string;
  mode: "ask" | "act";
  system: string;
  /** Conversation so far. New messages are pushed onto it. */
  history: Message[];
  tools: ToolDefinition[];
  executor: BrowserExecutor;
  maxSteps: number;
  autoApprove: boolean;
  requestApproval: (label: string, call: ToolCallPart, confirm?: ConfirmPayload) => Promise<boolean>;
  /**
   * Shows the "tab in another window" card and resolves when it is cancelled or dismissed (Stop,
   * Escape, New chat). There is nothing to allow: whatever it resolves with, the step never runs
   * and the turn ends. Without it the turn still ends, with no card.
   */
  stopForOtherWindow?: (call: ToolCallPart, stop: OtherWindowStop) => Promise<unknown>;
  onEvent: (e: AgentEvent) => void;
  signal: AbortSignal;
  contextBudgetTokens?: number;
  /** Cap on one step's reply. Keep it generous: the model cannot resume a truncated answer. */
  maxOutputTokens?: number;
  refreshPage?: boolean;
};

export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

const DECLINED_TEXT = "The user declined this action. Stop and ask them how they want to proceed.";

/**
 * Phrases that assert a browser action was carried out. Weak models often imitate the shape of
 * the previous answer and report success without ever emitting the tool call, which leaves the
 * browser untouched while the user is told the job is done. English, Portuguese and Spanish.
 */
const CLAIMED_ACTION =
  /\b(i(?:'ve| have)?\s+(?:just\s+)?(?:opened|navigated|clicked|typed|searched|filled|submitted|went|loaded)|(?:opened|navigated to|clicked on|taken you to)\s+your|abri(?:u|)\b|naveguei|cliquei|digitei|pesquisei|preenchi|acessei|carreguei|abrí|hice clic|escribí|busqué)/i;

export async function runTurn(o: RunOptions): Promise<void> {
  let succeeded = 0;
  let failed = 0;
  let needsInput = false;
  // Counts feed the end-of-turn summary, so only results for calls the *model* asked for may
  // land here. Synthetic results (the Continue refresh, placeholders for interrupted calls) are
  // emitted straight to o.onEvent so the transcript stays complete without inflating the score.
  const onEvent = (e: AgentEvent) => {
    if (e.type === "tool_result") {
      if (e.result.isError) failed++; else succeeded++;
      if (e.declined) needsInput = true;
    }
    if (e.type === "done" || e.type === "error") {
      o.onEvent({ type: "summary", succeeded, failed,
        outcome: needsInput ? "needs_input" : e.type === "done" && e.reason === "end_turn" && !failed ? "finished" : "incomplete",
        reason: e.type === "error" ? "provider_error" : e.reason });
    }
    o.onEvent(e);
  };
  const failures = new Map<string, number>();
  // A step aimed at a tab in another window: show the card (Cancel only) and wait for it to be
  // cancelled or dismissed. Nothing is run either way; the caller ends the turn.
  // Returns false only when the run was already stopped before the card could show.
  const showOtherWindow = async (call: ToolCallPart, stop: OtherWindowStop): Promise<boolean> => {
    log.warn("agent", "Stopped: the target tab is in another window", { tool: call.name });
    if (o.signal.aborted) return false;
    if (!o.stopForOtherWindow) return true;
    onEvent({ type: "other_window", call, stop: { tabId: stop.tabId, title: stop.title } });
    onEvent({ type: "status", message: "Stopped: tab in another window", step: 0 });
    // Cancel, Stop and Escape all just close the card; the run then ends as an other-window stop.
    await o.stopForOtherWindow(call, stop);
    return true;
  };
  let nudged = false;
  let claimCorrected = false;
  let toolCallsThisTurn = 0;
  try {
    if (o.refreshPage) {
      if (o.signal.aborted) return void onEvent({ type: "done", reason: "aborted" });
      const call: ToolCallPart = { type: "tool_call", id: `refresh_${Date.now()}`, name: "read_page", input: { filter: "interactive" } };
      onEvent({ type: "status", message: "Refreshing current page", step: 0 });
      const plan = await o.executor.prepare(call);
      o.history.push({ role: "assistant", parts: [call] });
      onEvent({ type: "tool_start", call, label: plan.label, sensitive: false });
      let out: ToolOutput;
      let moved: OtherWindowStop | null = null;
      let carded = false;
      try { out = await plan.run(); }
      catch (e) {
        moved = otherWindowOf(e);
        if (moved) {
          carded = await showOtherWindow(call, moved);
          out = { content: [{ type: "text", text: OTHER_WINDOW_TEXT }], isError: true };
        } else out = { content: [{ type: "text", text: errorText(e, o.executor.currentNonce?.()) }], isError: true };
      }
      const r = result(call, out);
      o.history.push({ role: "tool", parts: [r] });
      o.onEvent({ type: "tool_result", call, result: r, declined: moved ? true : undefined });
      if (moved) {
        if (!carded) return void onEvent({ type: "done", reason: "aborted" });
        needsInput = true;
        return void onEvent({ type: "done", reason: "other_window" });
      }
      // A failed refresh used to end the turn here, before the model was ever asked. On a
      // browser-internal page (a new tab, settings) that is every attempt: Continue, Read page
      // again and the first message after a restore all failed, and the only way out was
      // navigating by hand. The failure is already in the history, so the model knows the page
      // is unreadable and can navigate away or say so — not blind, just honest.
      if (out.isError) log.warn("agent", "Page refresh failed; continuing with the failure in context");
    }
    for (let step = 0; step < o.maxSteps; step++) {
      if (o.signal.aborted) return void onEvent({ type: "done", reason: "aborted" });
      // Drop superseded page observations so the model sees one current browser state rather
      // than several contradictory ones from earlier steps and turns.
      const before = historySize(o.history);
      const compacted = compactHistory(o.history);
      const budget = Math.max(2000, (o.contextBudgetTokens ?? 24000) - Math.ceil(o.system.length / 3) - 2000);
      const summarized = budgetHistory(o.history, budget);
      if (summarized) onEvent({ type: "notice", message: `Summarized ${summarized} older messages to stay within the context budget.` });
      if (estimateTokens(o.history) > budget) trimToolResults(o.history, budget);
      if (estimateTokens(o.history) > budget) throw new Error("The current request exceeds the context budget. Increase it in Settings, shorten the request, or start a new chat.");
      log.info("agent", `Step ${step + 1}/${o.maxSteps}`, {
        model: o.model,
        historyMessages: o.history.length,
        contextChars: historySize(o.history),
        ...(compacted.observations + compacted.screenshots + compacted.headers > 0
          ? { compacted, freedChars: before - historySize(o.history) }
          : {}),
      });
      onEvent({ type: "assistant_start" });
      onEvent({ type: "status", message: "Waiting for provider", step: step + 1 });

      let textAcc = "";
      let thinkingAcc = "";
      const calls: ToolCallPart[] = [];
      let stop: StopReason = "end_turn";

      for await (const ev of o.provider.stream({
        model: o.model,
        system: o.system,
        messages: o.history,
        tools: o.tools,
        maxTokens: o.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        signal: o.signal,
      })) {
        switch (ev.type) {
          case "status":
            onEvent({ type: "status", message: ev.phase === "connected" ? "Connected, waiting for model" : "Model responding", step: step + 1, model: ev.model });
            break;
          case "text_delta":
            if (!textAcc) onEvent({ type: "status", message: "Model responding", step: step + 1 });
            textAcc += ev.text;
            onEvent({ type: "text", delta: ev.text });
            break;
          case "thinking_delta":
            thinkingAcc += ev.text;
            onEvent({ type: "thinking", delta: ev.text });
            break;
          case "tool_call":
            calls.push(ev.call);
            break;
          case "usage":
            onEvent({ type: "usage", inputTokens: ev.inputTokens, outputTokens: ev.outputTokens });
            break;
          case "done":
            stop = ev.stopReason;
            break;
        }
      }

      // Providers that ignore the tools parameter print the call instead of emitting it.
      // Honour calls that name one of our tools; never execute another harness's.
      if (!calls.length && textAcc.trim()) {
        const allowed = new Set(o.tools.map((t) => t.name));
        const recovered = extractTextToolCalls(textAcc, allowed);
        if (recovered.calls.length) {
          log.warn("agent", "Recovered tool calls written as text", {
            names: recovered.calls.map((c) => c.name),
          });
          onEvent({ type: "retract_text" });
          textAcc = recovered.cleaned;
          if (textAcc) onEvent({ type: "text", delta: textAcc });
          calls.push(...recovered.calls);
        } else if (recovered.foreign.length || CLAIMS_NO_TOOLS.test(textAcc)) {
          log.warn("agent", "Provider ignored the tool definitions", {
            foreignTools: recovered.foreign,
            reply: textAcc.slice(0, 200),
          });
          onEvent({
            type: "notice",
            message:
              "This model answered as if Enki's tools did not exist" +
              (recovered.foreign.length ? ` (it tried to use ${recovered.foreign[0]}, which belongs to another tool)` : "") +
              ". Free gateway pools rotate between providers and some drop tool definitions — turn on Compatibility mode in Settings → Behavior, send the message again, or pick a specific model.",
          });
        }
      }

      const parts: Array<TextPart | ToolCallPart> = [];
      if (textAcc.trim()) parts.push({ type: "text", text: textAcc });
      parts.push(...calls);

      // Some (mostly free) models end a turn with no text and no tool call, typically after
      // reasoning or tool results. Nudge once; if it happens again, surface it to the user.
      if (!parts.length) {
        // Weaker models often write the whole answer into the reasoning channel and leave
        // content empty. Show that rather than discarding the turn.
        log.warn("agent", "Turn produced no text and no tool call", {
          reasoningChars: thinkingAcc.length,
          stopReason: stop,
          alreadyNudged: nudged,
        });
        const salvaged = thinkingAcc.trim();
        if (salvaged) {
          onEvent({ type: "promote_thinking" });
          o.history.push({ role: "assistant", parts: [{ type: "text", text: salvaged }] });
          return void onEvent({ type: "done", reason: stop });
        }
        if (!nudged) {
          nudged = true;
          o.history.push({
            role: "user",
            parts: [{ type: "text", text: "(Your last reply was empty. Answer the request now in plain text.)" }],
          });
          continue;
        }
        return void onEvent({ type: "done", reason: "empty" });
      }
      // A turn that reports a completed browser action while never calling a tool has done
      // nothing at all. Retract the claim and make the model face the tab it is actually on.
      if (
        !calls.length &&
        o.mode === "act" &&
        toolCallsThisTurn === 0 &&
        !claimCorrected &&
        CLAIMED_ACTION.test(textAcc)
      ) {
        claimCorrected = true;
        log.warn("agent", "Reply claimed a browser action but no tool was called", {
          reply: textAcc.slice(0, 300),
        });
        const tab = await o.executor.currentTab().catch(() => null);
        const nonce = o.executor.currentNonce?.();
        const whereRaw = tab
          ? `${tab.title ?? ""} (${tab.url ?? ""})`
          : "an unknown page";
        // Keep the nudge out of an unfenced user-role payload: wrap page-derived title/URL.
        const where = nonce
          ? fence(whereRaw, { source: "agent_nudge", nonce, url: tab?.url, maxChars: 500 })
          : neutralize(whereRaw);
        onEvent({ type: "retract_text" });
        o.history.push({ role: "assistant", parts });
        // System-style correction via tool role is unavailable without a call id; fence the
        // page-derived bit and keep the instruction Enki-authored outside the fence.
        o.history.push({
          role: "user",
          parts: [
            {
              type: "text",
              text:
                `You called no tool, so nothing happened in the browser — the active tab is still:\n${where}\n` +
                "Do not describe actions. Either call the tool that performs what was asked now, or tell the user plainly that you did not do it and why.",
            },
          ],
        });
        continue;
      }

      o.history.push({ role: "assistant", parts });

      if (stop === "max_tokens") {
        onEvent({
          type: "notice",
          message: `This reply hit the ${o.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS}-token output cap and was cut off. Raise "Max output tokens" in Settings, or ask for a shorter answer.`,
        });
      }
      if (!calls.length) return void onEvent({ type: "done", reason: stop });
      toolCallsThisTurn += calls.length;

      const results: ToolResultPart[] = [];
      let declined = false;
      let repeatedFailure = false;
      let otherWindow = false;
      let otherWindowCarded = false;
      try {
        for (const call of calls) {
          if (o.signal.aborted) throw new DOMException("Aborted", "AbortError");
          if (declined || repeatedFailure || otherWindow) {
            results.push(result(call, { content: [{ type: "text", text: "Skipped because this task has stopped." }], isError: true }));
            continue;
          }
          let plan;
          const fingerprint = call.name + JSON.stringify(call.input, Object.keys(call.input).sort());
          const recordFailure = () => {
            const count = (failures.get(fingerprint) ?? 0) + 1;
            failures.set(fingerprint, count);
            repeatedFailure = count >= 3;
          };
          try {
            if (!o.tools.some((t) => t.name === call.name)) throw new Error(`Tool ${call.name} is unavailable in ${o.mode} mode.`);
            plan = await o.executor.prepare(call);
          } catch (e) {
            const moved = otherWindowOf(e);
            if (moved) {
              onEvent({ type: "tool_start", call, label: call.name, sensitive: false });
              otherWindowCarded = await showOtherWindow(call, moved);
              otherWindow = true;
              const r = result(call, { content: [{ type: "text", text: OTHER_WINDOW_TEXT }], isError: true });
              results.push(r);
              onEvent({ type: "tool_result", call, result: r, declined: true });
              continue;
            }
            recordFailure();
            const r = result(call, { content: [{ type: "text", text: errorText(e, o.executor.currentNonce?.()) }], isError: true });
            results.push(r);
            onEvent({ type: "tool_start", call, label: call.name, sensitive: false });
            onEvent({ type: "tool_result", call, result: r });
            continue;
          }
          log.info("tool", `${call.name}: ${plan.label}`, { input: call.input, sensitive: plan.sensitive });
          onEvent({ type: "tool_start", call, label: plan.label, sensitive: plan.sensitive });
          onEvent({ type: "status", message: `Executing ${call.name}`, step: step + 1 });
          // Structured policy: autoApprove may skip only the categories mayAutoApprove allows.
          // Page-requested, cross-origin, downloads, uploads, account changes and sensitive
          // inputs always ask; Incognito always asks. Hard blocks never reach prepare().
          const decision = plan.sensitive || plan.alwaysAsk
            ? confirmDecision(plan.classification ?? {
                categories: [], primary: null, target: plan.label, origin: "", value: "",
                pageRequested: !!plan.confirm?.pageRequested, requiresConfirm: true,
                unnamedRecipient: false, incognito: false,
                connectorAllowed: false, sameOrigin: true, formHasSensitiveFilled: false,
              }, o.autoApprove, plan.alwaysAsk)
            : "skip";
          if (decision === "ask") {
            onEvent({ type: "approval_request", call, label: plan.label, confirm: plan.confirm });
            onEvent({ type: "status", message: "Waiting for your approval", step: step + 1 });
            const approved = await o.requestApproval(plan.label, call, plan.confirm);
            // Stop may resolve the approval while the user is deciding. Never run the
            // pending action, even if an approval click raced with cancellation.
            if (o.signal.aborted) throw new DOMException("Aborted", "AbortError");
            if (!approved) {
              declined = true;
              const r = result(call, { content: [{ type: "text", text: DECLINED_TEXT }], isError: true });
              results.push(r);
              onEvent({ type: "tool_result", call, result: r, declined: true });
              continue;
            }
          }
          let out: ToolOutput;
          onEvent({ type: "status", message: `Executing ${call.name}`, step: step + 1 });
          try {
            out = await plan.run();
          } catch (e) {
            if (o.signal.aborted) throw e;
            const moved = otherWindowOf(e);
            if (moved) {
              otherWindowCarded = await showOtherWindow(call, moved);
              otherWindow = true;
              const r = result(call, { content: [{ type: "text", text: OTHER_WINDOW_TEXT }], isError: true });
              results.push(r);
              onEvent({ type: "tool_result", call, result: r, declined: true });
              continue;
            }
            log.error("tool", `${call.name} failed`, { error: errMsg(e) });
            out = { content: [{ type: "text", text: errorText(e, o.executor.currentNonce?.()) }], isError: true };
          }
          const r = result(call, out);
          if (out.isError) recordFailure(); else failures.delete(fingerprint);
          // Never log fence nonces (or raw page text that embeds them).
          const turnNonce = o.executor.currentNonce?.();
          const logged = out.content.map((c) => (c.type !== "text" ? "[image]" : redactForLog(c.text, turnNonce)))
            .join("\n").slice(0, 600);
          log.info("tool", `${call.name} → ${out.isError ? "error" : "ok"}`, { output: logged });
          results.push(r);
          onEvent({ type: "tool_result", call, result: r });
        }
      } finally {
        // Keep the transcript valid even if we were interrupted mid-way: every tool call needs a result.
        for (const call of calls.slice(results.length)) {
          const r = result(call, { content: [{ type: "text", text: "Interrupted. Outcome unknown; inspect the page before retrying." }], isError: true });
          results.push(r);
          o.onEvent({ type: "tool_result", call, result: r });
        }
        o.history.push({ role: "tool", parts: results });
      }
      // The card was cancelled or dismissed: the task ends here, with no further model call.
      if (otherWindow) {
        if (!otherWindowCarded) return void onEvent({ type: "done", reason: "aborted" });
        return void onEvent({ type: "done", reason: "other_window" });
      }
      if (repeatedFailure) {
        onEvent({ type: "notice", message: "The same action failed three times. Read the page again or switch models before continuing." });
        return void onEvent({ type: "done", reason: "repeated_failure" });
      }
    }
    onEvent({ type: "done", reason: "max_steps" });
  } catch (e) {
    if (o.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
      onEvent({ type: "done", reason: "aborted" });
    } else {
      log.error("agent", "Turn failed", { error: errMsg(e) });
      onEvent({ type: "error", message: errMsg(e) });
    }
  } finally {
    await o.executor.release().catch(() => undefined);
  }
}

/** The executor's TabInOtherWindowError, recognised without importing the executor (and chrome). */
function otherWindowOf(e: unknown): OtherWindowStop | null {
  if (!e || typeof e !== "object" || (e as { name?: unknown }).name !== "TabInOtherWindowError") return null;
  const stop = (e as { stop?: OtherWindowStop }).stop;
  return stop && typeof stop === "object" ? stop : null;
}

const OTHER_WINDOW_TEXT = "Stopped: that tab is in another window. Enki only acts in the window it was opened in, and nothing was done in the other window. Do not retry; the user cancelled this task.";

function result(call: ToolCallPart, out: ToolOutput): ToolResultPart {
  return { type: "tool_result", toolCallId: call.id, name: call.name, content: out.content, isError: out.isError };
}

/**
 * A tool error as the model sees it. Error text can quote a page or an MCP server's body, so it is
 * fenced as tool_error data; Enki's own "Error:" prefix stays outside the fence.
 */
function errorText(e: unknown, nonce: string | undefined): string {
  return fenceError(errMsg(e), nonce);
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
