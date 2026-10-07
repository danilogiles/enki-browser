/**
 * Connections: apps Enki can use through their MCP servers (Jira, Linear, Notion…). Each one's
 * tools are offered to the model next to the browser tools, named `<connection>__<tool>`.
 *
 * Tools the server marks read-only run straight away; anything else changes data in the user's
 * account, so it waits for the approval card, unless the user allowed that one tool to run
 * without asking. Text that comes back is data from that service, never instructions.
 *
 * The list lives in chrome.storage.local under `enki:connections`; sign-in tokens under
 * `enki:connection-auth`, never in settings exports or diagnostics.
 */
import type { ToolDefinition } from "../types";
import { McpClient, McpHttpError, type CallResult, type McpTool } from "./mcp";
import { refresh, signIn, type Auth } from "./oauth";
import { decrypt, encrypt } from "../secrets";

export type ConnectorTool = { name: string; title: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean; allowed?: boolean };

export type Connection = {
  id: string;
  name: string;
  url: string;
  /** oauth: sign in on the service's page. token: a personal access token sent as a bearer. */
  auth: "oauth" | "token" | "none";
  enabled: boolean;
  tools: ConnectorTool[];
  status?: "connected" | "needs-sign-in" | "error";
  error?: string;
};

export type Preset = { id: string; name: string; url: string; auth: Connection["auth"]; hint: string };

/** Official remote MCP servers that let any client sign in (checked 2026-10-04). */
export const PRESETS: Preset[] = [
  { id: "atlassian", name: "Jira & Confluence", url: "https://mcp.atlassian.com/v1/mcp", auth: "oauth", hint: "Atlassian Cloud: issues, projects, pages" },
  { id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp", auth: "oauth", hint: "Issues, projects, cycles" },
  { id: "notion", name: "Notion", url: "https://mcp.notion.com/mcp", auth: "oauth", hint: "Pages and databases" },
  { id: "sentry", name: "Sentry", url: "https://mcp.sentry.dev/mcp", auth: "oauth", hint: "Errors and issues" },
  { id: "github", name: "GitHub", url: "https://api.githubcopilot.com/mcp/", auth: "token", hint: "Needs a personal access token (github.com/settings/tokens)" },
];

const LIST = "enki:connections";
const AUTH = "enki:connection-auth";

export async function loadConnections(): Promise<Connection[]> {
  return ((await chrome.storage.local.get(LIST))[LIST] as Connection[] | undefined) ?? [];
}

export async function saveConnections(list: Connection[]): Promise<void> {
  await chrome.storage.local.set({ [LIST]: list });
}

// Each connection's sign-in is stored as one encrypted string (lib/secrets.ts); entries written
// before encryption existed are plain objects and get encrypted the first time they are read.
async function authOf(id: string): Promise<Auth | undefined> {
  const value = ((await chrome.storage.local.get(AUTH))[AUTH] as Record<string, Auth | string> | undefined)?.[id];
  if (!value) return undefined;
  if (typeof value !== "string") { await setAuth(id, value); return value; }
  const plain = await decrypt(value);
  return plain ? (JSON.parse(plain) as Auth) : undefined;
}

export async function setAuth(id: string, auth: Auth | null): Promise<void> {
  const all = ((await chrome.storage.local.get(AUTH))[AUTH] as Record<string, Auth | string> | undefined) ?? {};
  if (auth) all[id] = await encrypt(JSON.stringify(auth)); else delete all[id];
  await chrome.storage.local.set({ [AUTH]: all });
}

export function onConnectionsChange(cb: (list: Connection[]) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[LIST]) cb((changes[LIST].newValue as Connection[] | undefined) ?? []);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// ---------- talking to a server

const clients = new Map<string, McpClient>();

function clientFor(conn: Connection): McpClient {
  let c = clients.get(conn.id);
  if (!c) {
    c = new McpClient(conn.url, async (): Promise<Record<string, string>> => {
      if (conn.auth === "none") return {};
      let auth = await authOf(conn.id);
      if (!auth) return {};
      if (conn.auth === "oauth" && auth.expiresAt && auth.expiresAt < Date.now() + 60_000 && auth.refreshToken) {
        auth = await refresh(auth);
        await setAuth(conn.id, auth);
      }
      return { Authorization: `Bearer ${auth.accessToken}` };
    });
    clients.set(conn.id, c);
  }
  return c;
}

const toTool = (t: McpTool, previous?: ConnectorTool): ConnectorTool => ({
  name: t.name,
  title: t.title ?? t.annotations?.title ?? t.name,
  description: (t.description ?? "").slice(0, 1000),
  inputSchema: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
  readOnly: t.annotations?.readOnlyHint === true,
  allowed: previous?.allowed,
});

/**
 * Connects (signing in first when the server asks for it) and refreshes the tool list. Returns
 * the updated connection; failures are recorded on it rather than thrown.
 */
export async function connect(conn: Connection, opts: { interactive: boolean; token?: string }): Promise<Connection> {
  clients.delete(conn.id);
  if (opts.token !== undefined) await setAuth(conn.id, { accessToken: opts.token.trim() });
  const attempt = async () => {
    const client = clientFor(conn);
    await client.initialize();
    const tools = await client.listTools();
    const before = new Map(conn.tools.map((t) => [t.name, t]));
    return { ...conn, tools: tools.map((t) => toTool(t, before.get(t.name))), status: "connected" as const, error: undefined };
  };
  try {
    return await attempt();
  } catch (e) {
    if (e instanceof McpHttpError && e.status === 401 && conn.auth === "oauth") {
      if (!opts.interactive) return { ...conn, status: "needs-sign-in", error: "Sign in to use it." };
      try {
        await setAuth(conn.id, await signIn(conn.url, e.wwwAuthenticate));
        clients.delete(conn.id);
        return await attempt();
      } catch (e2) {
        return { ...conn, status: "error", error: e2 instanceof Error ? e2.message : String(e2) };
      }
    }
    if (e instanceof McpHttpError && e.status === 401) return { ...conn, status: "needs-sign-in", error: "The server refused the token." };
    return { ...conn, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function disconnect(conn: Connection): Promise<void> {
  clients.delete(conn.id);
  await setAuth(conn.id, null);
}

// ---------- tools for the model

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20) || "app";

export function toolName(conn: Connection, tool: ConnectorTool): string {
  return `${slug(conn.name)}__${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export function connectorTools(list: Connection[]): ToolDefinition[] {
  return list.filter((c) => c.enabled && c.status === "connected").flatMap((c) =>
    c.tools.map((t) => ({
      name: toolName(c, t),
      description: `[${c.name}] ${t.description || t.title}${t.readOnly ? "" : " (Changes data in the user's account; the user confirms first.)"}`,
      inputSchema: t.inputSchema as ToolDefinition["inputSchema"],
    })),
  );
}

export function findTool(list: Connection[], name: string): { conn: Connection; tool: ConnectorTool } | null {
  for (const conn of list) {
    if (!conn.enabled || conn.status !== "connected") continue;
    const tool = conn.tools.find((t) => toolName(conn, t) === name);
    if (tool) return { conn, tool };
  }
  return null;
}

/** Runs a tool and turns its MCP content into what the agent loop understands. */
export async function runTool(conn: Connection, tool: ConnectorTool, args: Record<string, unknown>): Promise<{ text: string; images: Array<{ data: string; mediaType: string }>; isError: boolean }> {
  let result: CallResult;
  try {
    result = await clientFor(conn).callTool(tool.name, args);
  } catch (e) {
    if (e instanceof McpHttpError && e.status === 401) throw new Error(`${conn.name} needs you to sign in again (Settings → Connections).`);
    throw e;
  }
  const texts: string[] = [];
  const images: Array<{ data: string; mediaType: string }> = [];
  for (const c of result.content ?? []) {
    if (c.type === "text") texts.push(String((c as { text: string }).text));
    else if (c.type === "image") images.push({ data: String((c as { data: string }).data), mediaType: String((c as { mimeType: string }).mimeType) });
    else texts.push(JSON.stringify(c).slice(0, 4000));
  }
  if (!texts.length && result.structuredContent !== undefined) texts.push(JSON.stringify(result.structuredContent));
  let text = texts.join("\n\n") || "(no content)";
  if (text.length > 30000) text = `${text.slice(0, 30000)}\n[…truncated]`;
  return { text: `[${conn.name} · ${tool.title}]\n${text}`, images, isError: !!result.isError };
}
