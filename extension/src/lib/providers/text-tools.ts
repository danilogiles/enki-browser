import type { ChatProvider, ChatRequest, ImagePart, Message, StreamEvent, TextPart, ToolDefinition } from "../types";

/**
 * Compatibility mode for gateways that only relay plain chat.
 *
 * OmniRoute's keyless routes (Cloudflare Playground, for one) forward nothing but user and
 * assistant text: the system prompt, the `tools` array and every `role: "tool"` message are
 * dropped before the upstream model sees them. The model then answers "I have no tools", or
 * guesses a call syntax from the tool name alone. Some routes even send `tools: []`, which the
 * upstream rejects outright ("tools must not be an empty array").
 *
 * This wrapper rewrites the conversation into the one shape those routes do deliver: the
 * instructions and tool catalogue travel inside the first user message, earlier tool calls are
 * shown as the JSON the model is asked to write, and tool results come back as user text. The
 * agent loop already recovers calls written as text (toolcall-text.ts), so nothing else changes.
 */
export class TextToolsProvider implements ChatProvider {
  readonly id: string;

  constructor(private inner: ChatProvider) {
    this.id = `${inner.id}+text-tools`;
  }

  listModels(): Promise<string[]> {
    return this.inner.listModels();
  }

  stream(req: ChatRequest): AsyncIterable<StreamEvent> {
    return this.inner.stream(toTextProtocol(req));
  }
}

export function toTextProtocol(req: ChatRequest): ChatRequest {
  const out: Message[] = [];
  // Strict chat templates reject two user (or two assistant) turns in a row, and a tool
  // result followed by the next request is exactly that once both become user text.
  const push = (role: "user" | "assistant", parts: Array<TextPart | ImagePart>) => {
    const last = out[out.length - 1];
    if (last && last.role === role) {
      if (role === "assistant") {
        last.parts.push({ type: "text", text: "\n\n" + textOnly(parts) });
      } else {
        (last.parts as Array<TextPart | ImagePart>).push({ type: "text", text: "\n\n" }, ...parts);
      }
    } else if (role === "assistant") {
      out.push({ role, parts: [{ type: "text", text: textOnly(parts) }] });
    } else {
      out.push({ role, parts: [...parts] });
    }
  };

  for (const m of req.messages) {
    if (m.role === "user") {
      push("user", m.parts);
    } else if (m.role === "assistant") {
      const chunks: string[] = [];
      for (const p of m.parts) {
        if (p.type === "text" && p.text.trim()) chunks.push(p.text.trim());
        if (p.type === "tool_call") chunks.push(renderCall(p.name, p.input));
      }
      if (chunks.length) push("assistant", [{ type: "text", text: chunks.join("\n\n") }]);
    } else {
      for (const r of m.parts) {
        const text = r.content.filter((c): c is TextPart => c.type === "text").map((c) => c.text).join("\n");
        const images = r.content.filter((c): c is ImagePart => c.type === "image");
        push("user", [
          { type: "text", text: `[Result of ${r.name}${r.isError ? " — failed" : ""}]\n${text || (images.length ? "(image attached)" : "(no output)")}` },
          ...images,
        ]);
      }
    }
  }

  const preamble = buildPreamble(req.system, req.tools);
  const first = out.findIndex((m) => m.role === "user");
  if (first === -1) {
    out.unshift({ role: "user", parts: [{ type: "text", text: preamble }] });
  } else {
    (out[first].parts as Array<TextPart | ImagePart>).unshift({ type: "text", text: preamble + "\n\n# Conversation\n" });
  }

  // Weak models drift back to prose after a few tool results; the reminder sits where it is
  // read last. Only when tools exist — in a tool-less request it would be noise.
  const last = out[out.length - 1];
  if (req.tools.length && last?.role === "user") {
    (last.parts as Array<TextPart | ImagePart>).push({ type: "text", text: `\n\n${REMINDER}` });
  }

  return { ...req, system: "", messages: splitLongMessages(out, MAX_MESSAGE_CHARS), tools: [] };
}

/**
 * Cloudflare Playground refuses any single message over 6000 characters ("Prompt too long"),
 * yet accepts many of them in a row and keeps the context across them. Instructions plus the
 * tool catalogue, or one read_page result, are well past that, so long user turns are cut into
 * consecutive user messages under the cap. The margin covers whatever the gateway adds.
 */
const MAX_MESSAGE_CHARS = 5000;

function splitLongMessages(messages: Message[], max: number): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    if (m.role !== "user" || textOnly(m.parts).length <= max) {
      out.push(m);
      continue;
    }
    const images = m.parts.filter((p): p is ImagePart => p.type === "image");
    const pieces = chunkText(textOnly(m.parts), max);
    pieces.forEach((piece, i) => {
      const last = i === pieces.length - 1;
      out.push({ role: "user", parts: [{ type: "text", text: last ? piece : `${piece}\n(continued in the next message)` }, ...(last ? images : [])] });
    });
  }
  return out;
}

/** Cuts at the last line break before the limit so JSON lines and snapshot rows stay whole. */
function chunkText(text: string, max: number): string[] {
  const size = max - 40; // room for the "(continued…)" marker
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < size / 2) cut = size;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) pieces.push(rest);
  return pieces;
}

const REMINDER =
  "(To use a tool, reply with only the JSON block described in the instructions. When the task is done, answer in plain text.)";

function buildPreamble(system: string, tools: ToolDefinition[]): string {
  const sections = [`# Instructions\n${system.trim()}`];
  if (tools.length) {
    sections.push(
      [
        "# Tools",
        "You control the browser through the tools below. This connection does not support native function calling, so you call a tool by writing a JSON block and nothing else:",
        "",
        "```json",
        '{"tool": "<tool name>", "arguments": { ... }}',
        "```",
        "",
        "Rules:",
        "- One JSON block per tool call; you may write several blocks to run them in order.",
        "- Use only the tool names listed here, with arguments matching their schema.",
        '- After you call a tool, stop and wait. The result arrives in the next message as "[Result of <tool>]".',
        "- Never claim an action happened unless its result came back.",
        "- When you have what you need, answer the user in plain text with no JSON block.",
        "",
        "Available tools:",
        ...tools.map(renderTool),
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

function renderTool(t: ToolDefinition): string {
  const schema = t.inputSchema as { properties?: Record<string, { type?: string; enum?: unknown[]; description?: string }>; required?: string[] };
  const required = new Set(schema.required ?? []);
  const args = Object.entries(schema.properties ?? {}).map(([name, p]) => {
    const type = p.enum ? p.enum.map((v) => JSON.stringify(v)).join("|") : p.type ?? "any";
    return `    - ${name}${required.has(name) ? "" : " (optional)"}: ${type}${p.description ? ` — ${p.description}` : ""}`;
  });
  return [`- ${t.name}: ${t.description}`, ...(args.length ? args : ["    (no arguments)"])].join("\n");
}

function renderCall(name: string, input: Record<string, unknown>): string {
  return "```json\n" + JSON.stringify({ tool: name, arguments: input }) + "\n```";
}

function textOnly(parts: Array<TextPart | ImagePart>): string {
  return parts.filter((p): p is TextPart => p.type === "text").map((p) => p.text).join("");
}
