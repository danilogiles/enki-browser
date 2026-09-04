import Anthropic from "@anthropic-ai/sdk";
import { log } from "../debug";
import type {
  ChatProvider,
  ChatRequest,
  Message,
  StopReason,
  StreamEvent,
  ToolCallPart,
  ToolDefinition,
} from "../types";

/** Models that accept adaptive thinking (Claude 4.6+ family). Older ones would need budget_tokens; we skip thinking there. */
const ADAPTIVE_THINKING = /(opus-4-[6-9]|opus-5|sonnet-4-6|sonnet-5|fable|mythos)/;

export class AnthropicProvider implements ChatProvider {
  readonly id = "anthropic";
  private client: Anthropic;

  constructor(opts: { apiKey: string; baseUrl?: string }) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl || undefined,
      dangerouslyAllowBrowser: true,
      maxRetries: 2,
    });
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const m of this.client.models.list()) ids.push(m.id);
    return ids;
  }

  async *stream(req: ChatRequest): AsyncIterable<StreamEvent> {
    const params: Anthropic.MessageStreamParams = {
      model: req.model,
      max_tokens: req.maxTokens ?? 16000,
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: toAnthropicMessages(req.messages),
      tools: toAnthropicTools(req.tools),
    };
    if (ADAPTIVE_THINKING.test(req.model)) {
      params.thinking = { type: "adaptive", display: "summarized" };
    }

    const started = Date.now();
    log.info("provider", `Anthropic ${req.model}`, {
      messages: req.messages.length,
      tools: req.tools.length,
      thinking: !!params.thinking,
    });

    const stream = this.client.messages.stream(params, { signal: req.signal });

    // Accumulate tool_use input JSON per content block index.
    const pending = new Map<number, { id: string; name: string; json: string }>();

    for await (const event of stream) {
      switch (event.type) {
        case "content_block_start": {
          const block = event.content_block;
          if (block.type === "tool_use") {
            pending.set(event.index, { id: block.id, name: block.name, json: "" });
          }
          break;
        }
        case "content_block_delta": {
          const d = event.delta;
          if (d.type === "text_delta") yield { type: "text_delta", text: d.text };
          else if (d.type === "thinking_delta") yield { type: "thinking_delta", text: d.thinking };
          else if (d.type === "input_json_delta") {
            const p = pending.get(event.index);
            if (p) p.json += d.partial_json;
          }
          break;
        }
        case "content_block_stop": {
          const p = pending.get(event.index);
          if (p) {
            pending.delete(event.index);
            const call: ToolCallPart = {
              type: "tool_call",
              id: p.id,
              name: p.name,
              input: safeParse(p.json),
            };
            yield { type: "tool_call", call };
          }
          break;
        }
      }
    }

    const final = await stream.finalMessage();
    log.info("provider", `Anthropic stream ended after ${Date.now() - started}ms`, {
      stopReason: final.stop_reason,
      usage: final.usage,
    });
    yield {
      type: "usage",
      inputTokens:
        final.usage.input_tokens +
        (final.usage.cache_read_input_tokens ?? 0) +
        (final.usage.cache_creation_input_tokens ?? 0),
      outputTokens: final.usage.output_tokens,
    };
    yield { type: "done", stopReason: mapStop(final.stop_reason) };
  }
}

function safeParse(json: string): Record<string, unknown> {
  if (!json.trim()) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapStop(reason: Anthropic.Message["stop_reason"]): StopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
  }));
}

function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({
        role: "user",
        content: m.parts.map(
          (p): Anthropic.ContentBlockParam =>
            p.type === "text"
              ? { type: "text", text: p.text }
              : {
                  type: "image",
                  source: { type: "base64", media_type: p.mediaType, data: p.data },
                },
        ),
      });
    } else if (m.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      for (const p of m.parts) {
        if (p.type === "text") {
          if (p.text.trim()) content.push({ type: "text", text: p.text });
        } else {
          content.push({ type: "tool_use", id: p.id, name: p.name, input: p.input });
        }
      }
      if (content.length) out.push({ role: "assistant", content });
    } else {
      out.push({
        role: "user",
        content: m.parts.map(
          (r): Anthropic.ToolResultBlockParam => ({
            type: "tool_result",
            tool_use_id: r.toolCallId,
            is_error: r.isError,
            content: r.content.map((c) =>
              c.type === "text"
                ? { type: "text" as const, text: c.text }
                : {
                    type: "image" as const,
                    source: { type: "base64" as const, media_type: c.mediaType, data: c.data },
                  },
            ),
          }),
        ),
      });
    }
  }
  return out;
}
