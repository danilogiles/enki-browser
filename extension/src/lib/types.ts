/**
 * Provider-neutral message model. Every provider adapter converts to/from this shape,
 * so the agent loop, tools and UI never depend on a specific vendor API.
 */

export type TextPart = { type: "text"; text: string };

export type ImagePart = {
  type: "image";
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  /** base64 without the data: prefix */
  data: string;
};

export type ToolCallPart = {
  type: "tool_call";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultPart = {
  type: "tool_result";
  toolCallId: string;
  name: string;
  content: Array<TextPart | ImagePart>;
  isError?: boolean;
};

export type UserMessage = { role: "user"; parts: Array<TextPart | ImagePart> };
export type AssistantMessage = { role: "assistant"; parts: Array<TextPart | ToolCallPart> };
export type ToolMessage = { role: "tool"; parts: ToolResultPart[] };
export type Message = UserMessage | AssistantMessage | ToolMessage;

export type JsonSchema = Record<string, unknown>;

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; call: ToolCallPart }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; stopReason: StopReason };

export type ChatRequest = {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
  maxTokens?: number;
  signal?: AbortSignal;
};

export interface ChatProvider {
  readonly id: string;
  stream(req: ChatRequest): AsyncIterable<StreamEvent>;
  listModels(): Promise<string[]>;
}

export function textOf(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}
