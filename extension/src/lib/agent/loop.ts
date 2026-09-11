import type {
  ChatProvider,
  Message,
  StopReason,
  TextPart,
  ToolCallPart,
  ToolDefinition,
  ToolResultPart,
} from "../types";
import type { BrowserExecutor, ToolOutput } from "../tools/executor";
import { log } from "../debug";
import { budgetHistory, compactHistory, estimateTokens, historySize } from "./context";
import { CLAIMS_NO_TOOLS, extractTextToolCalls } from "./toolcall-text";

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
  | { type: "approval_request"; call: ToolCallPart; label: string }
  | { type: "tool_result"; call: ToolCallPart; result: ToolResultPart; declined?: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; reason: StopReason | "max_steps" | "aborted" | "empty" | "repeated_failure" }
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
  requestApproval: (label: string, call: ToolCallPart) => Promise<boolean>;
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
      try { out = await plan.run(); }
      catch (e) { out = { content: [{ type: "text", text: errMsg(e) }], isError: true }; }
      const r = result(call, out);
      o.history.push({ role: "tool", parts: [r] });
      o.onEvent({ type: "tool_result", call, result: r });
      if (out.isError) throw new Error("Could not refresh the controlled page. Select an accessible tab before continuing.");
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
              ". Free gateway pools rotate between providers and some ignore tool definitions — send the message again, or pick a specific model in Settings.",
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
        const where = await o.executor
          .currentTab()
          .then((t) => `"${t.title ?? ""}" (${t.url ?? ""})`)
          .catch(() => "an unknown page");
        onEvent({ type: "retract_text" });
        o.history.push({ role: "assistant", parts });
        o.history.push({
          role: "user",
          parts: [
            {
              type: "text",
              text:
                `You called no tool, so nothing happened in the browser — the active tab is still ${where}. ` +
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
      try {
        for (const call of calls) {
          if (o.signal.aborted) throw new DOMException("Aborted", "AbortError");
          if (declined || repeatedFailure) {
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
            recordFailure();
            const r = result(call, { content: [{ type: "text", text: `Error: ${errMsg(e)}` }], isError: true });
            results.push(r);
            onEvent({ type: "tool_start", call, label: call.name, sensitive: false });
            onEvent({ type: "tool_result", call, result: r });
            continue;
          }
          log.info("tool", `${call.name}: ${plan.label}`, { input: call.input, sensitive: plan.sensitive });
          onEvent({ type: "tool_start", call, label: plan.label, sensitive: plan.sensitive });
          onEvent({ type: "status", message: `Executing ${call.name}`, step: step + 1 });
          if (plan.sensitive && !o.autoApprove) {
            onEvent({ type: "approval_request", call, label: plan.label });
            onEvent({ type: "status", message: "Waiting for your approval", step: step + 1 });
            const approved = await o.requestApproval(plan.label, call);
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
            log.error("tool", `${call.name} failed`, { error: errMsg(e) });
            out = { content: [{ type: "text", text: `Error: ${errMsg(e)}` }], isError: true };
          }
          const r = result(call, out);
          if (out.isError) recordFailure(); else failures.delete(fingerprint);
          log.info("tool", `${call.name} → ${out.isError ? "error" : "ok"}`, {
            output: out.content.map((c) => (c.type === "text" ? c.text : "[image]")).join("\n").slice(0, 600),
          });
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

function result(call: ToolCallPart, out: ToolOutput): ToolResultPart {
  return { type: "tool_result", toolCallId: call.id, name: call.name, content: out.content, isError: out.isError };
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
