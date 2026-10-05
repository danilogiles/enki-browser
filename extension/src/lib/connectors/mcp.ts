/**
 * A small Model Context Protocol client over Streamable HTTP, the transport remote MCP servers
 * (Atlassian, Linear, Notion, Sentry, GitHub…) speak: JSON-RPC in a POST, answered either with
 * JSON or with a server-sent-event stream carrying the response. Only what Enki needs is here:
 * initialize, tools/list, tools/call.
 *
 * The extension's host permissions exempt these requests from CORS, so response headers such as
 * Mcp-Session-Id are readable without the server allowing it.
 */

export const PROTOCOL_VERSION = "2025-06-18";

export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
};

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: string; [k: string]: unknown };

export type CallResult = { content?: McpContent[]; structuredContent?: unknown; isError?: boolean };

/** The server refused the request; `status` 401 with `wwwAuthenticate` means "sign in first". */
export class McpHttpError extends Error {
  constructor(message: string, readonly status: number, readonly wwwAuthenticate: string | null) {
    super(message);
  }
}

type Session = { id: string | null; version: string };

export class McpClient {
  private session: Session | null = null;
  private nextId = 1;

  constructor(private readonly url: string, private readonly headers: () => Promise<Record<string, string>>) {}

  private async post(body: unknown, expectResponse: boolean, signal?: AbortSignal): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(await this.headers()),
    };
    if (this.session?.id) headers["Mcp-Session-Id"] = this.session.id;
    if (this.session) headers["MCP-Protocol-Version"] = this.session.version;
    const res = await fetch(this.url, { method: "POST", headers, body: JSON.stringify(body), signal, credentials: "omit" });
    if (!res.ok && res.status !== 202) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new McpHttpError(`${this.url} answered ${res.status}${detail ? `: ${detail}` : ""}`, res.status, res.headers.get("www-authenticate"));
    }
    const sessionId = res.headers.get("mcp-session-id");
    if (sessionId && this.session) this.session.id = sessionId;
    if (sessionId && !this.session) this.pendingSessionId = sessionId;
    if (!expectResponse || res.status === 202) return undefined;
    const id = (body as { id: number }).id;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/event-stream")) return readEventStream(res, id);
    return pick(await res.json(), id);
  }

  private pendingSessionId: string | null = null;

  async request<T>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    if (!this.session && method !== "initialize") await this.initialize(signal);
    try {
      return (await this.post({ jsonrpc: "2.0", id: this.nextId++, method, params }, true, signal)) as T;
    } catch (e) {
      // A 404 with a session means the server forgot it: start a new one, once.
      if (e instanceof McpHttpError && e.status === 404 && this.session?.id) {
        this.session = null;
        await this.initialize(signal);
        return (await this.post({ jsonrpc: "2.0", id: this.nextId++, method, params }, true, signal)) as T;
      }
      throw e;
    }
  }

  async initialize(signal?: AbortSignal): Promise<{ serverInfo?: { name?: string; version?: string }; instructions?: string }> {
    this.pendingSessionId = null;
    const result = (await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "Enki", version: chrome.runtime.getManifest().version } },
    }, true, signal)) as { protocolVersion?: string; serverInfo?: { name?: string }; instructions?: string };
    this.session = { id: this.pendingSessionId, version: result.protocolVersion ?? PROTOCOL_VERSION };
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, false, signal);
    return result;
  }

  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r = await this.request<{ tools?: McpTool[]; nextCursor?: string }>("tools/list", cursor ? { cursor } : {}, signal);
      tools.push(...(r.tools ?? []));
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    return tools;
  }

  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallResult> {
    return this.request<CallResult>("tools/call", { name, arguments: args }, signal);
  }
}

type RpcMessage = { id?: number | string; result?: unknown; error?: { code: number; message: string } };

function pick(message: RpcMessage | RpcMessage[], id: number): unknown {
  const list = Array.isArray(message) ? message : [message];
  const match = list.find((m) => m.id === id);
  if (!match) throw new Error("The MCP server answered without a response to the request.");
  if (match.error) throw new Error(`MCP error ${match.error.code}: ${match.error.message}`);
  return match.result;
}

/** Reads server-sent events until the response to `id` arrives, then stops listening. */
async function readEventStream(res: Response, id: number): Promise<unknown> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, "");
        const data = event.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        if (!data) continue;
        let message: RpcMessage;
        try { message = JSON.parse(data); } catch { continue; }
        if (message.id === id) return pick(message, id);
      }
      if (done) break;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  throw new Error("The MCP server closed the stream without answering.");
}
