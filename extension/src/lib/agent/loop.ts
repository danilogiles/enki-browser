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

export type AgentEvent =
  | { type: "assistant_start" }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  /** The turn produced only reasoning: show it as the answer instead of hiding it. */
  | { type: "promote_thinking" }
  | { type: "tool_start"; call: ToolCallPart; label: string; sensitive: boolean }
  | { type: "approval_request"; call: ToolCallPart; label: string }
  | { type: "tool_result"; call: ToolCallPart; result: ToolResultPart; declined?: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; reason: StopReason | "max_steps" | "aborted" | "empty" }
  | { type: "error"; message: string };

export type RunOptions = {
  provider: ChatProvider;
  model: string;
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
};

const DECLINED_TEXT = "The user declined this action. Stop and ask them how they want to proceed.";

export async function runTurn(o: RunOptions): Promise<void> {
  const { onEvent } = o;
  let nudged = false;
  try {
    for (let step = 0; step < o.maxSteps; step++) {
      if (o.signal.aborted) return void onEvent({ type: "done", reason: "aborted" });
      onEvent({ type: "assistant_start" });

      let textAcc = "";
      let thinkingAcc = "";
      const calls: ToolCallPart[] = [];
      let stop: StopReason = "end_turn";

      for await (const ev of o.provider.stream({
        model: o.model,
        system: o.system,
        messages: o.history,
        tools: o.tools,
        signal: o.signal,
      })) {
        switch (ev.type) {
          case "text_delta":
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

      const parts: Array<TextPart | ToolCallPart> = [];
      if (textAcc.trim()) parts.push({ type: "text", text: textAcc });
      parts.push(...calls);

      // Some (mostly free) models end a turn with no text and no tool call, typically after
      // reasoning or tool results. Nudge once; if it happens again, surface it to the user.
      if (!parts.length) {
        // Weaker models often write the whole answer into the reasoning channel and leave
        // content empty. Show that rather than discarding the turn.
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
      o.history.push({ role: "assistant", parts });

      if (!calls.length) return void onEvent({ type: "done", reason: stop });

      const results: ToolResultPart[] = [];
      let declined = false;
      try {
        for (const call of calls) {
          if (o.signal.aborted) throw new DOMException("Aborted", "AbortError");
          if (declined) {
            results.push(result(call, { content: [{ type: "text", text: "Skipped: a previous action was declined." }], isError: true }));
            continue;
          }
          let plan;
          try {
            plan = await o.executor.prepare(call);
          } catch (e) {
            const r = result(call, { content: [{ type: "text", text: `Error: ${errMsg(e)}` }], isError: true });
            results.push(r);
            onEvent({ type: "tool_start", call, label: call.name, sensitive: false });
            onEvent({ type: "tool_result", call, result: r });
            continue;
          }
          onEvent({ type: "tool_start", call, label: plan.label, sensitive: plan.sensitive });
          if (plan.sensitive && !o.autoApprove) {
            onEvent({ type: "approval_request", call, label: plan.label });
            const approved = await o.requestApproval(plan.label, call);
            if (!approved) {
              declined = true;
              const r = result(call, { content: [{ type: "text", text: DECLINED_TEXT }], isError: true });
              results.push(r);
              onEvent({ type: "tool_result", call, result: r, declined: true });
              continue;
            }
          }
          let out: ToolOutput;
          try {
            out = await plan.run();
          } catch (e) {
            if (o.signal.aborted) throw e;
            out = { content: [{ type: "text", text: `Error: ${errMsg(e)}` }], isError: true };
          }
          const r = result(call, out);
          results.push(r);
          onEvent({ type: "tool_result", call, result: r });
        }
      } finally {
        // Keep the transcript valid even if we were interrupted mid-way: every tool call needs a result.
        for (const call of calls.slice(results.length)) {
          results.push(result(call, { content: [{ type: "text", text: "Cancelled by the user." }], isError: true }));
        }
        o.history.push({ role: "tool", parts: results });
      }
    }
    onEvent({ type: "done", reason: "max_steps" });
  } catch (e) {
    if (o.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
      onEvent({ type: "done", reason: "aborted" });
    } else {
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
