/**
 * Where the model endpoint (the BYOM provider's base URL) may be reached over plain HTTP.
 * Enki 0.8.12, Cloak's rule. It applies to the model address only; websites stay HTTPS-only.
 *
 *   - Loopback (localhost, 127.0.0.0/8, [::1]): HTTP allowed, an API key too. The traffic
 *     never leaves the machine (Ollama on :11434, OmniRoute on :20128).
 *   - A private IP literal (10/8, 172.16/12, 192.168/16, fc00::/7): HTTP blocked until the user
 *     allows that exact origin (scheme + host + port). An API key is never sent to it over HTTP.
 *   - Any other host name (ollama.local, ollama.casa) or a public IP: HTTPS only, no exception.
 *     Over HTTP a name can be rebound to another device (DNS rebinding).
 *
 * Pure and dependency-free: the Settings screen and the request layer (every provider fetch)
 * both call it, so the screen cannot allow what a request would refuse, or the other way round.
 */

/** Migration (Enki 0.8.12): a saved private-IP HTTP endpoint with no key keeps working. */
export const CARRY_OVER_PRIVATE_HTTP = true;

export type HostClass = "loopback" | "private" | "public-ip" | "hostname";

export type EndpointState =
  /** HTTPS, or anything that is not plain HTTP to a non-loopback host. */
  | "https"
  /** HTTP to this machine. */
  | "loopback"
  /** HTTP to a private IP the user has not allowed. */
  | "private-off"
  /** HTTP to a private IP the user allowed for this exact origin. */
  | "private-on"
  /** HTTP to a host name other than localhost. */
  | "hostname"
  /** HTTP to a public IP. */
  | "public"
  /** An API key with a non-loopback HTTP endpoint (even an allowed private IP). */
  | "key-over-http"
  /** Not a URL, or a scheme other than http(s). */
  | "invalid";

export type EndpointVerdict = {
  state: EndpointState;
  /** Whether a request may go out. */
  allowed: boolean;
  /** The exact origin, scheme://host:port with the port always written out ("" when invalid). */
  origin: string;
  /** host:port, for labels ("192.168.1.20:11434"). */
  hostPort: string;
  hostClass?: HostClass;
};

export function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

function classifyIPv4([a, b]: number[]): HostClass {
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  return "public-ip";
}

/** Expands an IPv6 literal (no brackets) to eight 16-bit groups, or null. */
export function parseIPv6(host: string): number[] | null {
  if (!/^[0-9a-f:.]+$/i.test(host) || !host.includes(":")) return null;
  let h = host;
  // An embedded IPv4 tail (::ffff:1.2.3.4); the URL parser normally rewrites it to hex.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (v4) {
    const p = parseIPv4(v4[1]);
    if (!p) return null;
    h = h.slice(0, -v4[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** The URL's hostname (as `new URL()` gives it: lower case, IPv6 in brackets) → its class. */
export function classifyHost(hostname: string): HostClass {
  const host = hostname.toLowerCase();
  if (host === "localhost") return "loopback";
  const v4 = parseIPv4(host);
  if (v4) return classifyIPv4(v4);
  if (host.startsWith("[") && host.endsWith("]")) {
    const g = parseIPv6(host.slice(1, -1));
    if (!g) return "hostname";
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return "loopback";
    // IPv4-mapped (::ffff:a.b.c.d): judged as the IPv4 address it reaches.
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      return classifyIPv4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]);
    }
    if ((g[0] & 0xfe00) === 0xfc00) return "private";
    return "public-ip";
  }
  return "hostname";
}

/** scheme://host:port with the default port written out, so an exception names one exact origin. */
export function exactOrigin(url: URL): string {
  const port = url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
  return `${url.protocol}//${url.hostname}${port ? `:${port}` : ""}`;
}

function parse(baseUrl: string): URL | null {
  try { return new URL(baseUrl.trim()); } catch { return null; }
}

/** The exact origin of an endpoint URL, or "" when it does not parse. */
export function originOf(baseUrl: string): string {
  const u = parse(baseUrl);
  return u ? exactOrigin(u) : "";
}

/** Keeps only well-formed exact http origins of private IPs: nothing else can be an exception. */
export function sanitizeExceptions(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<string>();
  for (const v of list) {
    if (typeof v !== "string") continue;
    const u = parse(v);
    if (!u || u.protocol !== "http:" || classifyHost(u.hostname) !== "private") continue;
    const o = exactOrigin(u);
    if (o === v) out.add(o);
  }
  return [...out];
}

/**
 * The verdict for one endpoint. `hasKey` is whether an API key would be sent; `exceptions` is
 * the saved list of exact origins the user allowed (Settings.localHttpOrigins).
 */
export function evaluateEndpoint(
  baseUrl: string,
  opts: { hasKey: boolean; exceptions?: readonly string[] },
): EndpointVerdict {
  const u = parse(baseUrl);
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) {
    return { state: "invalid", allowed: false, origin: "", hostPort: "" };
  }
  const origin = exactOrigin(u);
  const hostPort = origin.replace(/^[a-z]+:\/\//, "");
  const hostClass = classifyHost(u.hostname);
  const v = (state: EndpointState, allowed: boolean): EndpointVerdict => ({ state, allowed, origin, hostPort, hostClass });
  if (u.protocol === "https:") return v("https", true);
  if (hostClass === "loopback") return v("loopback", true);
  if (hostClass === "hostname") return v("hostname", false);
  if (hostClass === "public-ip") return v("public", false);
  // A private IP over HTTP. The key check comes first: with a key it is blocked even when allowed.
  if (opts.hasKey) return v("key-over-http", false);
  const allowedHere = sanitizeExceptions(opts.exceptions ?? []).includes(origin);
  return v(allowedHere ? "private-on" : "private-off", allowedHere);
}

/** A request the endpoint policy refused. The message names the reason in the user's terms. */
export class EndpointBlockedError extends Error {
  constructor(readonly verdict: EndpointVerdict, message: string) {
    super(message);
    this.name = "EndpointBlockedError";
  }
}

/** What a refused request says (Ink's 05 strings; title and body). */
export function blockedMessage(verdict: EndpointVerdict, s: {
  refusedTitle: string; refusedBody: string; refusedHint: string; publicTitle: string; publicBody: string;
  keyTitle: string; keyBody: string; keyHint: string; toggle: string; offNote: string;
}): string {
  switch (verdict.state) {
    case "hostname": return `${s.refusedTitle}. ${s.refusedBody} ${s.refusedHint}`;
    case "public": return `${s.publicTitle}. ${s.publicBody}`;
    case "key-over-http": return `${s.keyTitle}. ${s.keyBody} ${s.keyHint}`;
    case "private-off": return `${s.offNote} Settings → Model → ${s.toggle} (${verdict.origin}).`;
    default: return "The model address is not a valid http:// or https:// URL.";
  }
}

/** Adds the exact origin of `baseUrl` to the list, only if it is a private IP over HTTP. */
export function addException(list: readonly string[] | undefined, baseUrl: string): string[] {
  const u = parse(baseUrl);
  const cur = sanitizeExceptions(list ?? []);
  if (!u || u.protocol !== "http:" || classifyHost(u.hostname) !== "private") return cur;
  const o = exactOrigin(u);
  return cur.includes(o) ? cur : [...cur, o];
}

/** Revoke: the saved exception for that exact origin is deleted. */
export function removeException(list: readonly string[] | undefined, originOrUrl: string): string[] {
  const o = originOf(originOrUrl);
  return sanitizeExceptions(list ?? []).filter((x) => x !== o);
}

export type EndpointNotice = {
  kind: "carried" | "private-off" | "blocked-host" | "blocked-public" | "blocked-key";
  origin: string;
};

/**
 * The one-time 0.8.12 migration of a saved endpoint. A private IP over HTTP with no key is
 * carried over (CARRY_OVER_PRIVATE_HTTP) as an exception for that exact origin only; with a key
 * it is blocked and the key stays stored but is never sent. Host names and public IPs over HTTP
 * are blocked. Loopback and HTTPS endpoints need nothing and get no notice.
 */
export function migrateEndpoint(
  baseUrl: string,
  hasKey: boolean,
  exceptions: readonly string[] | undefined,
  carryOver: boolean = CARRY_OVER_PRIVATE_HTTP,
): { exceptions: string[]; notice: EndpointNotice | null } {
  const list = sanitizeExceptions(exceptions ?? []);
  const verdict = evaluateEndpoint(baseUrl, { hasKey, exceptions: list });
  const notice = (kind: EndpointNotice["kind"]) => ({ exceptions: list, notice: { kind, origin: verdict.origin } });
  switch (verdict.state) {
    case "hostname": return notice("blocked-host");
    case "public": return notice("blocked-public");
    case "key-over-http": return notice("blocked-key");
    case "private-off":
      if (!carryOver) return notice("private-off");
      return { exceptions: addException(list, baseUrl), notice: { kind: "carried", origin: verdict.origin } };
    default: return { exceptions: list, notice: null };
  }
}
