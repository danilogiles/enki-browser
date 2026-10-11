// Configuration comes only from the environment the MCP client starts this server with (the
// client's MCP config or a secret store). Nothing in a tool call can change it: the payload has no
// sender, key, relay or mailbox field, and the schema rejects unknown fields.
import { readFileSync } from "node:fs";
import { devPassthroughSealer } from "./shared.js";

export const DEFAULT_RELAY_URL = "http://127.0.0.1:8788";
export const DEV_MAILBOX_ID = "dev-mailbox-0000";

const MAILBOX = /^[A-Za-z0-9_-]{16,128}$/;

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
 *   ENKI_RELAY_URL         relay base URL (default http://127.0.0.1:8788)
 *   ENKI_MAILBOX_ID        mailbox id from pairing
 *   ENKI_AGENT_KEY         agent private key from pairing (or ENKI_AGENT_KEY_FILE: path to it)
 *   ENKI_DEV_PASSTHROUGH=1 DEV-ONLY: send unencrypted, unsigned packets to a loopback relay
 *   ENKI_MCP_DEBUG=1       metadata (never content) on stderr
 */
export function loadConfig(env = process.env) {
  const debug = env.ENKI_MCP_DEBUG === "1";
  const warnings = [];
  try {
    const relay = checkRelayUrl(env.ENKI_RELAY_URL || DEFAULT_RELAY_URL);
    const dev = env.ENKI_DEV_PASSTHROUGH === "1";
    let agentKey = env.ENKI_AGENT_KEY || "";
    if (!agentKey && env.ENKI_AGENT_KEY_FILE) agentKey = readFileSync(env.ENKI_AGENT_KEY_FILE, "utf8").trim();

    if (dev) {
      if (!relay.loopback) throw new Error("ENKI_DEV_PASSTHROUGH sends packets unencrypted and unsigned, so it only works with a relay on 127.0.0.1/localhost");
      const mailbox = env.ENKI_MAILBOX_ID || DEV_MAILBOX_ID;
      if (!MAILBOX.test(mailbox)) throw new Error("ENKI_MAILBOX_ID must be 16-128 characters of A-Z a-z 0-9 _ -");
      warnings.push("DEV-ONLY passthrough: packets are NOT encrypted or signed. Never use this with a real relay.");
      if (agentKey) warnings.push("ENKI_AGENT_KEY is ignored in dev passthrough mode.");
      return { ok: true, debug, warnings, relayUrl: relay.url, mailbox, sealer: devPassthroughSealer };
    }

    if (!agentKey) throw new Error("Not paired: set ENKI_AGENT_KEY (or ENKI_AGENT_KEY_FILE) and ENKI_MAILBOX_ID from pairing with Enki");
    // TODO(Blink): build the real sealer from agentKey + ENKI_MAILBOX_ID once the envelope and
    // pairing format is published (docs/0.9-receber-abas.md). Until then there is no secure mode.
    throw new Error("Encrypted delivery is not available yet: the envelope/pairing format is still being defined. For local development, set ENKI_DEV_PASSTHROUGH=1 with a loopback relay.");
  } catch (e) {
    return { ok: false, debug, warnings, error: e instanceof Error ? e.message : String(e) };
  }
}
