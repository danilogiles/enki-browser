# Enki: send tabs (MCP server)

An [MCP](https://modelcontextprotocol.io) server with one tool, `deliver_tabs`, that lets an AI
agent hand you a short list of links as a tab group in [Enki Browser](../README.md). Enki asks you
first; nothing opens unless you accept, and each tab waits on Enki's hold page until you click
**Open**.

> **Status: 0.9 preview.** Every packet is encrypted to your Enki and signed with this agent's
> key (format: [`docs/0.9-receber-abas.md`](../docs/0.9-receber-abas.md), appendix "Protocolo").
> There is no unencrypted mode, not even for development.

No dependencies, Node.js 20 or newer, MIT licensed. It runs from a checkout of this repository
because it shares the schema (`protocol/`) and the validator (`extension/src/lib/a2a/`) with the
extension.

## The tool

`deliver_tabs` takes:

| Field | Type | Rules |
|---|---|---|
| `title` | string | 1–60 characters. Name of the tab group. |
| `summary` | string, optional | Up to 1500 characters of plain text, shown on a card. |
| `links` | array | 1–10 items of `{ "url": "https://…", "label"?: "…" }`; label up to 80 characters. |

Only `http`/`https` URLs, without `user:password@`, spaces or control characters, up to 2048
characters. Unknown fields are refused. The full schema is
[`protocol/deliver_tabs.schema.json`](../protocol/deliver_tabs.schema.json).

The tool answers with a short confirmation or the reasons the bundle was refused. It never tells
the agent whether you accepted, declined or opened anything.

## Setup

```bash
git clone https://github.com/danilogiles/enki-browser.git
cd enki-browser/mcp
npm test        # optional: runs the tests, no install needed
```

### Pair with Enki

Each agent gets its own pairing. In Enki: Settings → **Agentes** → turn on *Receber abas de
agentes*, set the relay, click **Parear agente**. Within 5 minutes, on the agent's machine:

```bash
node ../scripts/send-tabs.mjs pair ENKI-XXXX-XXXX --name Helm --relay https://your-relay.example --key-file ~/.config/enki/helm.key
```

Both sides show the same 16-character fingerprint (`XXXX XXXX XXXX XXXX`). Compare it in full;
confirm on the agent side and click **Confirmar** in Enki only if it matches. The key file
(written `0600`, never printed) is this agent's secret: it holds its private keys, the relay URL and
the mailbox id.

Configuration is only through environment variables set in your MCP client's config. Nothing in a
tool call can change it.

| Variable | Meaning |
|---|---|
| `ENKI_AGENT_KEY_FILE` or `ENKI_AGENT_KEY` | Required. The agent key from pairing (`enki-agent-v1:…`): a path to the key file, or the key itself from the client's secret store. Never in a chat, a prompt or the repository. It carries the relay URL and mailbox id. |
| `ENKI_RELAY_URL` | Optional; if set it must match the relay in the agent key. `https://`, or plain `http://` only for `127.0.0.1`/`localhost`. |
| `ENKI_MAILBOX_ID` | Optional; if set it must match the mailbox in the agent key. |
| `ENKI_MCP_DEBUG=1` | Log events to stderr: counts, sizes, status codes. Never titles, summaries or links. |

Use the absolute path to `mcp/src/index.js` in your checkout below.

### Claude Desktop

`claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "enki-tabs": {
      "command": "node",
      "args": ["/path/to/enki-browser/mcp/src/index.js"],
      "env": {
        "ENKI_AGENT_KEY_FILE": "/home/you/.config/enki/helm.key"
      }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project), same shape:

```json
{
  "mcpServers": {
    "enki-tabs": {
      "command": "node",
      "args": ["/path/to/enki-browser/mcp/src/index.js"],
      "env": { "ENKI_AGENT_KEY_FILE": "/home/you/.config/enki/cursor.key" }
    }
  }
}
```

### n8n

n8n's built-in **MCP Client Tool** node only speaks HTTP (Streamable HTTP or SSE), not stdio. Use
the community node [`n8n-nodes-mcp`](https://www.npmjs.com/package/n8n-nodes-mcp) with a
**Command Line (STDIO)** credential: command `node`, arguments
`/path/to/enki-browser/mcp/src/index.js`, and the variables above under Environment. To use it as
an AI Agent tool, n8n needs `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true`.

Give each agent (n8n, Helm, …) its own pairing, so its key can be revoked alone.

### Any other MCP client

Start `node /path/to/enki-browser/mcp/src/index.js` as a stdio server with the environment above.
Protocol versions 2024-11-05 through 2025-11-25 are accepted.

## Security model

**What the tool can do:** send one bundle (title, optional summary, 1–10 links) to your Enki
through the relay, at most 5 an hour from this server. Enki enforces the same 5 an hour per agent
and at most 3 pending notices on its side, whatever the server does.

**What it cannot do:** open anything by itself (you accept or decline every bundle, and tabs wait
on the hold page), read your tabs, history, cookies or anything else from the browser, click or
type, switch the assistant to Act, change a setting, or learn what you did with a bundle.

- **Untrusted content.** Title, summary and labels are plain text: control characters and bidi
  overrides are stripped, and Enki renders them with `textContent`, never as HTML or Markdown, and
  never as instructions to its assistant. A summary that says "ignore previous instructions" is
  shown as exactly that text.
- **Links.** `http`/`https` only; `javascript:`, `data:`, `file:`, `blob:`, `chrome:`,
  `chrome-extension:`, `intent:` and credentials in URLs are refused. Enki shows lookalike
  internationalized domains in punycode and runs every link through Enki Shield; one blocked link
  rejects the whole bundle.
- **Identity.** There is no sender field. Enki knows who sent a bundle from the paired key that
  sealed it; the key comes only from this server's environment, never from a tool call.
- **Encryption.** X25519 + HKDF-SHA-256 + AES-256-GCM to the browser key of that pairing, signed
  with Ed25519 by this agent's key; Enki checks the signature before decrypting and refuses
  anything unsigned or unencrypted.
- **Relay.** It sees ciphertext of a fixed size, a random mailbox id and timing; it keeps a packet
  until Enki fetches it or for 10 minutes, then deletes it. Each packet carries a nonce and a
  timestamp inside the signed part, so Enki rejects replays and anything older than 10 minutes.
- **No telemetry.** The only network request is the POST to the relay you configured, with no
  cookies or identifying headers; redirects are refused. Nothing is logged unless
  `ENKI_MCP_DEBUG=1`, and then only metadata, to stderr.

The threat model for this feature is [`docs/0.9-threat-model.md`](../docs/0.9-threat-model.md); report vulnerabilities privately
as described in [SECURITY.md](../SECURITY.md).
