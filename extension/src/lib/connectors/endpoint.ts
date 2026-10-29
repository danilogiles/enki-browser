/**
 * The endpoint rule for connections (MCP servers and their OAuth sign-in), AIC-3, Enki 0.8.14.
 * It reuses the BYOM model-endpoint policy (providers/endpoint-policy.ts) with a credential
 * always assumed, because a connector request can carry one (a bearer token, an OAuth code,
 * a client secret, a refresh token):
 *
 *   - https:// to any host: allowed.
 *   - http:// to this machine (localhost, 127.0.0.0/8, [::1]): allowed; never leaves the device.
 *   - http:// to anything else (a LAN IP, a host name, a public IP): refused. There is no
 *     per-origin exception here: the "allow this private address" switch belongs to the model
 *     endpoint only, and it never lets a key over http either.
 *
 * Requests never follow redirects (`redirect: "error"`): the target would skip this check.
 * OAuth endpoints named in server metadata must be https://; http:// loopback is accepted only
 * when the MCP server itself is on this machine (a local dev server signing in locally).
 *
 * Pure apart from the fetch wrapper, so the Connections screen and the request layer agree.
 */
import { classifyHost, evaluateEndpoint, type EndpointVerdict } from "../providers/endpoint-policy";

/** A connector request the endpoint rule refused. */
export class ConnectorEndpointError extends Error {
  constructor(readonly verdict: EndpointVerdict, message: string) {
    super(message);
    this.name = "ConnectorEndpointError";
  }
}

export function connectorVerdict(url: string): EndpointVerdict {
  return evaluateEndpoint(url, { hasKey: true, exceptions: [] });
}

/** Why this address cannot be used for a connection, in the user's terms, or null when it can. */
export function connectorUrlProblem(url: string, what = "The MCP server address"): string | null {
  const v = connectorVerdict(url);
  if (v.allowed) return null;
  if (v.state === "invalid") return `${what} is not a valid https:// URL.`;
  return `${what} (${v.hostPort}) uses plain http://. Enki connects to apps over https:// only, so a sign-in or token is never sent unencrypted. http:// works only for this computer (localhost, 127.0.0.1, [::1]).`;
}

/** Throws ConnectorEndpointError unless the MCP server address passes the rule. */
export function assertConnectorEndpoint(url: string, what?: string): void {
  const problem = connectorUrlProblem(url, what);
  if (problem) throw new ConnectorEndpointError(connectorVerdict(url), problem);
}

function isLoopbackHttp(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && classifyHost(u.hostname) === "loopback";
  } catch {
    return false;
  }
}

/**
 * Why an OAuth URL (from a WWW-Authenticate header or server metadata) cannot be used, or null.
 * https:// is required; http:// loopback only when the MCP server is itself loopback http.
 */
export function oauthUrlProblem(url: unknown, mcpUrl: string, what: string): string | null {
  if (typeof url !== "string" || !url) return `The sign-in metadata has no ${what}.`;
  let u: URL;
  try { u = new URL(url); } catch { return `The sign-in metadata's ${what} is not a valid URL.`; }
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:" && isLoopbackHttp(url) && isLoopbackHttp(mcpUrl)) return null;
  return `The sign-in metadata points the ${what} at ${u.protocol === "http:" ? `plain http:// (${u.host})` : `a ${u.protocol} address`}. Enki signs in over https:// only. Use a token instead, or ask the app to fix its OAuth metadata.`;
}

export function assertOAuthEndpoint(url: unknown, mcpUrl: string, what: string): asserts url is string {
  const problem = oauthUrlProblem(url, mcpUrl, what);
  if (problem) throw new ConnectorEndpointError(connectorVerdict(typeof url === "string" ? url : ""), problem);
}

/** fetch for connector traffic: never follows a redirect and never sends the browser's cookies. */
export function connectorFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, credentials: "omit", redirect: "error" });
}
