import type {
  ChatProvider,
  ChatRequest,
  ImagePart,
  Message,
  StreamEvent,
  ToolCallPart,
  ToolDefinition,
} from "../types";

/**
 * Adapter for any OpenAI-compatible /chat/completions endpoint:
 * OpenAI, Gemini (OpenAI endpoint), Groq, OpenRouter, Ollama, LM Studio, vLLM...
 * Implemented with fetch + SSE parsing to stay dependency-free.
 */
export class OpenAICompatProvider implements ChatProvider {
  readonly id = "openai-compatible";

  constructor(private opts: { apiKey: string; baseUrl: string }) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.opts.apiKey) h.Authorization = `Bearer ${this.opts.apiKey}`;
    if (this.opts.baseUrl.includes("openrouter.ai")) {
      h["HTTP-Referer"] = "https://github.com/devopsfuturasync/enkibrowser";
      h["X-Title"] = "Enki";
    }
    return h;
  }

  private url(path: string): string {
    return this.opts.baseUrl.replace(/\/+$/, "") + path;
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(this.url("/models"), { headers: this.headers() });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => m.id).sort();
  }

  async *stream(req: ChatRequest): AsyncIterable<StreamEvent> {
    const isGemini = this.opts.baseUrl.includes("generativelanguage.googleapis.com");
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOpenAIMessages(req.system, req.messages),
      stream: true,
      max_completion_tokens: req.maxTokens ?? 16000,
    };
    if (req.tools.length) body.tools = toOpenAITools(req.tools);
    if (!isGemini) body.stream_options = { include_usage: true };

    const res = await fetch(this.url("/chat/completions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}${text ? `: ${errorText(text)}` : ""}`);
    }
    // Some gateways answer 200 with a JSON error body instead of an event stream.
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      const text = await res.text().catch(() => "");
      throw new Error(`Provider did not stream a response: ${errorText(text) || contentType || "empty body"}`);
    }

    const calls = new Map<number, { id: string; name: string; args: string }>();
    let finish: string | null = null;
    let usage: { inputTokens: number; outputTokens: number } | null = null;
    let chunks = 0;

    for await (const data of sseLines(res.body)) {
      if (data === "[DONE]") break;
      chunks++;
      let chunk: OpenAIChunk;
      try {
        chunk = JSON.parse(data) as OpenAIChunk;
      } catch {
        continue;
      }
      if (chunk.error) {
        throw new Error(typeof chunk.error === "string" ? chunk.error : chunk.error.message ?? JSON.stringify(chunk.error));
      }
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        };
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content) {
        yield { type: "text_delta", text: delta.content };
      }
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === "string" && reasoning) {
        yield { type: "thinking_delta", text: reasoning };
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const cur = calls.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(idx, cur);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }

    if (chunks === 0) {
      // Gateways like OmniRoute close the stream with only "[DONE]" when every upstream provider
      // failed or is rate-limited. Surface that instead of reporting an empty reply.
      throw new Error(
        "The provider closed the stream without sending anything. The model is probably rate-limited or unavailable right now; try again in a minute or pick another model.",
      );
    }

    for (const [idx, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      const call: ToolCallPart = {
        type: "tool_call",
        id: c.id || `call_${Date.now()}_${idx}`,
        name: c.name,
        input: safeParse(c.args),
      };
      yield { type: "tool_call", call };
    }

    if (usage) yield { type: "usage", ...usage };
    const stopReason =
      calls.size > 0 || finish === "tool_calls"
        ? "tool_use"
        : finish === "length"
          ? "max_tokens"
          : finish === "content_filter"
            ? "refusal"
            : "end_turn";
    yield { type: "done", stopReason };
  }
}

type OpenAIChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string;
      reasoning?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string } | string;
};

/** Pull a readable message out of an error body, JSON or plain text. */
function errorText(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const e = j.error;
    if (typeof e === "string") return e;
    if (e?.message) return e.message;
    if (j.message) return j.message;
  } catch {
    /* not JSON */
  }
  return body.slice(0, 500);
}

async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith("data:")) yield buf.slice(5).trim();
}

function safeParse(json: string): Record<string, unknown> {
  if (!json.trim()) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

function dataUrl(img: ImagePart): string {
  return `data:${img.mediaType};base64,${img.data}`;
}

function toOpenAIMessages(system: string, messages: Message[]): unknown[] {
  const out: unknown[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({
        role: "user",
        content: m.parts.map((p) =>
          p.type === "text"
            ? { type: "text", text: p.text }
            : { type: "image_url", image_url: { url: dataUrl(p) } },
        ),
      });
    } else if (m.role === "assistant") {
      const text = m.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("");
      const toolCalls = m.parts
        .filter((p): p is ToolCallPart => p.type === "tool_call")
        .map((p) => ({
          id: p.id,
          type: "function",
          function: { name: p.name, arguments: JSON.stringify(p.input) },
        }));
      const msg: Record<string, unknown> = { role: "assistant", content: text || null };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      out.push(msg);
    } else {
      // Tool results: text goes in the tool message; images (screenshots) follow as a user
      // message, since OpenAI-style tool messages are text-only.
      const images: Array<{ name: string; img: ImagePart }> = [];
      for (const r of m.parts) {
        const text = r.content
          .filter((c) => c.type === "text")
          .map((c) => (c as { text: string }).text)
          .join("\n");
        for (const c of r.content) if (c.type === "image") images.push({ name: r.name, img: c });
        out.push({
          role: "tool",
          tool_call_id: r.toolCallId,
          content: text || (images.length ? "(image attached below)" : "(no output)"),
        });
      }
      if (images.length) {
        out.push({
          role: "user",
          content: images.flatMap(({ name, img }) => [
            { type: "text", text: `[Image returned by tool ${name}]` },
            { type: "image_url", image_url: { url: dataUrl(img) } },
          ]),
        });
      }
    }
  }
  return out;
}
