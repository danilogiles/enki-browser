# Enki: send tabs (MCP server)

An [MCP](https://modelcontextprotocol.io) server with one tool, `deliver_tabs`, that lets an AI
agent hand you a short list of links as a tab group in [Enki Browser](../README.md). Enki asks you
first; nothing opens unless you accept, and each tab waits on Enki's hold page until you click
**Open**.

> **Status: 0.9 preview.** The envelope encryption and pairing format is still being defined.
> Until it lands, the server only runs in a **DEV-ONLY passthrough** mode that sends packets
> **unencrypted and unsigned** to a relay on your own machine. Do not point it at a real relay.

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

Configuration is only through environment variables set in your MCP client's config. Nothing in a
tool call can change it.

| Variable | Meaning |
|---|---|
| `ENKI_RELAY_URL` | Relay base URL. Must be `https://`; plain `http://` only for `127.0.0.1`/`localhost`. Default `http://127.0.0.1:8788`. |
| `ENKI_MAILBOX_ID` | Mailbox id from pairing with Enki. |
| `ENKI_AGENT_KEY` or `ENKI_AGENT_KEY_FILE` | This agent's private key from pairing (pending the pairing format). Keep it in the client's secret store or a file only you can read; never in a chat, a prompt or the repository. |
| `ENKI_DEV_PASSTHROUGH=1` | DEV-ONLY: send unencrypted, unsigned packets. Refused unless the relay is on loopback. |
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
        "ENKI_DEV_PASSTHROUGH": "1",
        "ENKI_RELAY_URL": "http://127.0.0.1:8788"
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
      "env": { "ENKI_DEV_PASSTHROUGH": "1" }
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
- **Relay.** It sees ciphertext of a fixed size, a random mailbox id and timing; it keeps a packet
  until Enki fetches it or for 10 minutes, then deletes it. Each packet carries a nonce and a
  timestamp inside the signed part, so Enki rejects replays and anything older than 10 minutes.
  *(Pending the envelope format; the DEV-ONLY passthrough has none of the crypto guarantees.)*
- **No telemetry.** The only network request is the POST to the relay you configured, with no
  cookies or identifying headers; redirects are refused. Nothing is logged unless
  `ENKI_MCP_DEBUG=1`, and then only metadata, to stderr.

The threat model for this feature is Cloak's 0.9 threat model; report vulnerabilities privately
as described in [SECURITY.md](../SECURITY.md).
