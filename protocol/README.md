# Receive tabs protocol (Enki 0.9)

An agent (Helm, an n8n workflow, any MCP client) sends Enki a **bundle**: a title, an optional
plain-text summary and 1 to 10 links. Enki asks the user, and only after Accept opens a tab group
whose tabs wait on Enki's hold page. In 0.9 the agent never reads tabs, clicks anything or learns
what the user did.

| File | What it is |
|---|---|
| [`deliver_tabs.schema.json`](deliver_tabs.schema.json) | The bundle, as JSON Schema. Single source of truth: the MCP server publishes it as the tool's input schema, and the extension's validator reads its limits from it. `x-enki` holds the limits JSON Schema cannot express. |
| [`../extension/src/lib/a2a/validate-bundle.js`](../extension/src/lib/a2a/validate-bundle.js) | Validator used on both sides (dependency-free ES module). |
| [`../extension/src/lib/a2a/envelope.js`](../extension/src/lib/a2a/envelope.js) | Packet framing: nonce, timestamp, fixed-size padding, size cap, `seal`/`open` interface. |
| [`../extension/src/lib/a2a/crypto.js`](../extension/src/lib/a2a/crypto.js) | The `enki-tabs-v1` envelope (X25519 + HKDF + AES-256-GCM, Ed25519), ids, pairing code, fingerprint, relay request signatures, agent key. |
| [`../extension/src/lib/a2a/pairing.js`](../extension/src/lib/a2a/pairing.js) | Commit-reveal pairing, both sides. |
| [`pairing-fingerprint.vectors.json`](pairing-fingerprint.vectors.json) | Test vectors for the commitment and the fingerprint. |
| [`../relay/`](../relay/) | Reference relay (Node and Cloudflare Workers). |
| [`../mcp/`](../mcp/) | The MCP server agents use to send a bundle. |

## Bundle

```json
{
  "title": "Pneu de neve",
  "summary": "Três opções abaixo de 900 CAD.",
  "links": [
    { "url": "https://www.example.ca/snow-tire", "label": "Example" }
  ]
}
```

- `title` 1–60 characters, `summary` up to 1500, `label` up to 80 (Unicode code points).
- No other field anywhere: no sender (the sender is the agent whose paired key sealed the
  packet), no mode, no action, no setting.
- Title, summary and labels are **untrusted plain text**. The validator strips control
  characters, bidi overrides/isolates (U+202A–202E, U+2066–2069, U+200E/200F, U+061C) and
  invisible characters, and interprets nothing. Render with `textContent`; never feed them to the
  assistant as instructions.
- Links: `http`/`https` only; no `user:password@` (not even empty); no whitespace, control,
  invisible or bidi characters; at most 2048 characters; duplicates dropped. The validator returns
  each link's ASCII (punycode) host for display, so `раураl.com` shows as `xn--l-7sba6dbr.com`.
- The serialized bundle must fit in one packet (`maxBundleBytes`, 10 KB).
- Enki Shield checks every link on the receiving side before the notice; one blocked link
  rejects the whole bundle. That check is not in the validator.

## Packet

```
frame    = { v: 1, nonce: <128-bit base64url>, ts: <ms since epoch>, bundle }
padded   = uint32 length ‖ UTF-8 JSON(frame) ‖ zeros, exactly 11 264 bytes
envelope = seal(padded)            → { v: 1, alg: "enki-tabs-v1", to, from, eph, nonce, ct, sig }, at most 16 384 bytes as JSON
```

Receiving: size cap first (before parsing or decrypting), then `open` (signature + decryption),
then reject frames older than 10 minutes, more than 2 minutes in the future, or with a nonce
already seen; then validate the bundle again. Every padded frame has the same size, so the relay
cannot tell how many links or how long a summary a packet carries.

**Cryptography, pairing and the relay API** are specified in
[`docs/0.9-receber-abas.md`](../docs/0.9-receber-abas.md), appendix "Protocolo (rascunho do
Blink)": fresh keys per pairing on both sides, commit-reveal pairing with a one-time code and a
16-character fingerprint compared on both sides, `enki-tabs-v1` envelopes signed with Ed25519 and
encrypted with X25519 + HKDF-SHA-256 + AES-256-GCM. The only `alg` is `enki-tabs-v1`; there is no
plaintext or unsigned mode.

Limits enforced by Enki, not by the agent: 5 packets an hour per agent and 3 pending notices
(extras are dropped silently), 10-minute TTL on the relay.
