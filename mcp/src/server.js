// A minimal MCP server over stdio: newline-delimited JSON-RPC 2.0 with initialize, ping,
// tools/list and tools/call. Hand-written instead of @modelcontextprotocol/sdk so this server has
// no dependencies to audit or update, like the extension's own MCP client
// (extension/src/lib/connectors/mcp.ts).
import { createDeliverTabs, TOOL_DESCRIPTION, TOOL_NAME } from "./deliver.js";
import { toolInputSchema } from "./shared.js";

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "enki-deliver-tabs", title: "Enki: send tabs", version: "0.9.0-dev" };

const INSTRUCTIONS =
  "Use deliver_tabs to hand the user a short list of links (1-10) as a tab group in Enki Browser. " +
  "The user is asked first and you get no feedback on what they do with it.";

export function createServer({ config, fetchImpl = fetch, now, log = () => {} }) {
  const deliverTabs = createDeliverTabs({ config, fetchImpl, now, log });
  const tool = {
    name: TOOL_NAME,
    title: "Send tabs to Enki",
    description: TOOL_DESCRIPTION,
    inputSchema: toolInputSchema(),
    annotations: { title: "Send tabs to Enki", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  };

  async function handle(msg) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      return error(msg?.id ?? null, -32600, "Invalid Request");
    }
    const isNotification = !("id" in msg);
    if (isNotification) return null; // notifications/initialized, notifications/cancelled, …
    const { id, method, params } = msg;
    switch (method) {
      case "initialize": {
        const asked = params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : SUPPORTED_PROTOCOL_VERSIONS[0];
        return ok(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
      }
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: [tool] });
      case "tools/call": {
        if (params?.name !== TOOL_NAME) return error(id, -32602, `Unknown tool: ${String(params?.name).slice(0, 64)}`);
        try {
          return ok(id, await deliverTabs(params.arguments));
        } catch {
          return ok(id, { content: [{ type: "text", text: "The bundle was not sent: internal error." }], isError: true });
        }
      }
      default:
        return error(id, -32601, `Method not found: ${method.slice(0, 64)}`);
    }
  }

  /** One line in, zero or one line out. Batches (2025-03-26) are answered as an array. */
  async function handleLine(line) {
    if (!line.trim()) return null;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return JSON.stringify(error(null, -32700, "Parse error"));
    }
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map(handle))).filter(Boolean);
      return out.length ? JSON.stringify(out) : null;
    }
    const res = await handle(msg);
    return res ? JSON.stringify(res) : null;
  }

  return { handle, handleLine, tool };
}

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const error = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
