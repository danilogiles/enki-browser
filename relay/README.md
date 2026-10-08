# Enki relay

Store-and-forward relay for Enki's **Receive tabs** (0.9). An agent leaves an encrypted packet in
a mailbox; Enki picks it up about once a minute. The relay cannot read packets: they are encrypted
to the browser and signed by the agent before they arrive (format:
[`docs/0.9-receber-abas.md`](../docs/0.9-receber-abas.md), appendix "Protocolo").

No dependencies beyond the shared `extension/src/lib/a2a/crypto.js`, MIT licensed.

## API

| Request | Who | What |
|---|---|---|
| `POST /v1/mailbox/{id}` | anyone | Leave one JSON envelope (`"v":1`, at most 16 384 bytes). `202`, or `413`/`400`/`429` |
| `GET /v1/mailbox/{id}` | the mailbox owner | `{"envelopes": [...]}`; every returned envelope is deleted |
| `DELETE /v1/mailbox/{id}` | the mailbox owner | Drop the mailbox (Enki does it when you unpair). `204` |
| `GET /health` | anyone | `{"ok":true}` |

- A pairing's mailbox id (22 base64url characters) is derived from the browser's Ed25519 key.
  `GET` and `DELETE` must carry `Enki-Key`, `Enki-Time` and `Enki-Sig` signed with that key
  (clock within 5 minutes), so only that Enki can drain or drop it.
- Pairing-exchange mailboxes (`p-` + 22 characters, derived from the one-time code) carry only a
  commitment, public keys and an encrypted reveal, and are readable without a signature.
- Envelopes expire after **10 minutes**; at most 20 per mailbox; deleted on delivery.

## Privacy

No logs, no accounts, no cookies, no analytics, no CORS, `cache-control: no-store`. The relay
sees ciphertext of a fixed size, the mailbox id, the time and the connecting IP (as any server
does), and keeps nothing after delivery or expiry. It never tells a sender whether an envelope was
fetched. Whoever runs a relay should also turn off request logging on the platform in front of it.

## Run it

### On your own machine (development)

```bash
node relay/server.js          # http://127.0.0.1:8788, in memory
npm --prefix relay test
```

Enki accepts plain `http://` only for a relay on `127.0.0.1`/`localhost`; anything else must be
`https://`.

### Self-hosted (Node)

`relay/server.js` listens on `127.0.0.1` (`ENKI_RELAY_HOST` / `ENKI_RELAY_PORT` to change it) and keeps mailboxes in
memory. Put it behind a reverse proxy that terminates TLS and does not log requests.

### Cloudflare Workers (free plan)

`src/worker.js` runs the same handler with one SQLite-backed Durable Object per mailbox, which the
Workers Free plan includes. (Workers KV's free daily write quota is too small for every paired
browser polling once a minute, so it is not used.)

```bash
cd relay
npx wrangler deploy           # needs your own Cloudflare account
```

`wrangler.toml` turns Workers observability (logs and traces) off.

**Not deployed.** This repository does not deploy a relay or create any account. Which service
hosts the project's default relay, and anything that could cost money, is decided by Danilo
first.
