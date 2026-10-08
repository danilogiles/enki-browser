// Configuration comes only from the environment the MCP client starts this server with (the
// client's MCP config or a secret store). Nothing in a tool call can change it: the payload has no
// sender, key, relay or mailbox field, and the schema rejects unknown fields.
import { readFileSync } from "node:fs";
import { decodeCredential, sealerFromCredential, TABS_ALG } from "./shared.js";

export const DEFAULT_RELAY_URL = "http://127.0.0.1:8788";

/** True for 127.0.0.0/8, ::1 and localhost: the only hosts allowed over plain http. */
export function isLoopbackHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h);
}

/** The relay must be https (threat model §2), except a relay on this machine for development. */
export function checkRelayUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`ENKI_RELAY_URL is not a valid URL`);
  }
  if (u.username || u.password) throw new Error("ENKI_RELAY_URL must not contain credentials");
  if (u.search || u.hash) throw new Error("ENKI_RELAY_URL must not have a query or fragment");
  const loopback = isLoopbackHost(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) {
    throw new Error("ENKI_RELAY_URL must use https (plain http is allowed only for a relay on 127.0.0.1/localhost)");
  }
  return { url: u.href.replace(/\/+$/, ""), loopback };
}

/**
 * Reads the configuration. Never throws: a problem is returned as `error` and reported by the
 * tool when it is called, so the MCP client still starts the server and can show why.
 *
 * Environment:
 *   ENKI_AGENT_KEY         the agent key pairing produced ("enki-agent-v1:…"; or ENKI_AGENT_KEY_FILE:
 *                          path to a file holding it). It carries the relay URL and mailbox id.
 *   ENKI_RELAY_URL         optional; if set it must match the relay in the agent key
 *   ENKI_MAILBOX_ID        optional; if set it must match the mailbox in the agent key
 *   ENKI_MCP_DEBUG=1       metadata (never content) on stderr
 * There is no unencrypted mode: every packet is encrypted to Enki and signed with the agent key.
 */
export function loadConfig(env = process.env) {
  const debug = env.ENKI_MCP_DEBUG === "1";
  const warnings = [];
  try {
    let agentKey = env.ENKI_AGENT_KEY || "";
    if (!agentKey && env.ENKI_AGENT_KEY_FILE) agentKey = readFileSync(env.ENKI_AGENT_KEY_FILE, "utf8").trim();
    if (!agentKey) throw new Error("Not paired: pair with Enki (Settings → Agentes → Parear agente, then `node scripts/send-tabs.mjs pair <code>`) and set ENKI_AGENT_KEY_FILE (or ENKI_AGENT_KEY)");
    const credential = decodeCredential(agentKey);
    const relay = checkRelayUrl(credential.relay);
    if (env.ENKI_RELAY_URL && checkRelayUrl(env.ENKI_RELAY_URL).url !== relay.url) throw new Error("ENKI_RELAY_URL differs from the relay this agent was paired through");
    if (env.ENKI_MAILBOX_ID && env.ENKI_MAILBOX_ID !== credential.mailbox) throw new Error("ENKI_MAILBOX_ID differs from the mailbox in the agent key");
    // The keys are imported once, on first use, as non-extractable CryptoKeys; the config object
    // keeps no copy of the key string.
    let ready;
    const sealer = Object.freeze({
      alg: TABS_ALG,
      async seal(paddedFrame) {
        ready ??= sealerFromCredential(agentKey);
        return (await ready).sealer.seal(paddedFrame);
      },
    });
    return { ok: true, debug, warnings, relayUrl: relay.url, mailbox: credential.mailbox, agentName: credential.name, sealer };
  } catch (e) {
    return { ok: false, debug, warnings, error: e instanceof Error ? e.message : String(e) };
  }
}
