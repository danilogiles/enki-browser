/**
 * Signing in to a remote MCP server the way the MCP spec describes: the server's 401 points to
 * its protected-resource metadata, that names the authorization server, Enki registers itself
 * there as a client (dynamic client registration, no app to pre-register), and the user signs in
 * on the service's own page in a small window, with PKCE.
 *
 * Enki never sees the user's password: only the service's page does. What comes back is a token
 * scoped to that service, kept in this browser's local extension storage.
 */

export type Auth = {
  accessToken: string;
  refreshToken?: string;
  /** ms since epoch */
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
  tokenEndpoint?: string;
  resource?: string;
};

type ServerMetadata = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
};

/** `key="value"` pairs of a WWW-Authenticate header. */
export function authParams(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of (header ?? "").matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

async function json<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: "omit", headers: { Accept: "application/json" } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** RFC 8414: the well-known path goes between the host and the issuer's own path. */
function wellKnown(issuer: string, name: string): string[] {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/$/, "");
  return path ? [`${u.origin}/.well-known/${name}${path}`, `${u.origin}${path}/.well-known/${name}`] : [`${u.origin}/.well-known/${name}`];
}

export async function discover(mcpUrl: string, wwwAuthenticate: string | null): Promise<{ server: ServerMetadata; scope?: string; resource: string }> {
  const params = authParams(wwwAuthenticate);
  const u = new URL(mcpUrl);
  const resourceUrls = params.resource_metadata
    ? [params.resource_metadata]
    : [...wellKnown(mcpUrl, "oauth-protected-resource"), `${u.origin}/.well-known/oauth-protected-resource`];
  let resource: { resource?: string; authorization_servers?: string[]; scopes_supported?: string[] } | null = null;
  for (const url of resourceUrls) if ((resource = await json(url))) break;
  // Without resource metadata (Atlassian), the MCP server's origin is the authorization server.
  const issuer = resource?.authorization_servers?.[0] ?? u.origin;
  let server: ServerMetadata | null = null;
  for (const url of [...wellKnown(issuer, "oauth-authorization-server"), ...wellKnown(issuer, "openid-configuration")]) {
    if ((server = await json<ServerMetadata>(url))?.authorization_endpoint) break;
    server = null;
  }
  if (!server) throw new Error(`${new URL(issuer).host} does not publish how to sign in (no OAuth metadata). Use a token instead.`);
  return { server, scope: params.scope, resource: resource?.resource ?? mcpUrl };
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge: b64url(digest) };
}

async function tokenRequest(endpoint: string, body: Record<string, string>, clientSecret?: string): Promise<Auth & { raw: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (clientSecret) headers.Authorization = `Basic ${btoa(`${body.client_id}:${clientSecret}`)}`;
  const res = await fetch(endpoint, { method: "POST", headers, body: new URLSearchParams(body), credentials: "omit" });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof raw.access_token !== "string") {
    throw new Error(`Sign-in failed at ${new URL(endpoint).host}: ${String(raw.error_description ?? raw.error ?? res.status)}`);
  }
  return {
    raw,
    accessToken: raw.access_token,
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : undefined,
    expiresAt: typeof raw.expires_in === "number" ? Date.now() + raw.expires_in * 1000 : undefined,
  };
}

/**
 * The loopback address the service sends the user back to, as desktop MCP clients use. Nothing
 * listens there: the sign-in window is watched, and the moment it heads to this address the code
 * is read from the URL and the window closed.
 *
 * chrome.identity.launchWebAuthFlow was the first choice and works, but its return address is a
 * chromiumapp.org subdomain, which ungoogled-chromium's domain substitution rewrites to
 * "ch40m1umapp.qjz9zk" — an address real services can refuse to register.
 */
export const REDIRECT_URI = "http://127.0.0.1:33418/enki/oauth/callback";

function signInWindow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let tabId: number | undefined;
    let windowId: number | undefined;
    const finish = (fn: () => void) => {
      chrome.webNavigation.onBeforeNavigate.removeListener(onNavigate);
      chrome.windows.onRemoved.removeListener(onClosed);
      fn();
    };
    const onNavigate = (d: { tabId: number; url: string }) => {
      if (d.tabId !== tabId || !d.url.startsWith(REDIRECT_URI)) return;
      finish(() => resolve(d.url));
      if (windowId !== undefined) void chrome.windows.remove(windowId).catch(() => undefined);
    };
    const onClosed = (id: number) => { if (id === windowId) finish(() => reject(new Error("Sign-in was closed before it finished."))); };
    chrome.webNavigation.onBeforeNavigate.addListener(onNavigate);
    chrome.windows.onRemoved.addListener(onClosed);
    chrome.windows.create({ url, type: "popup", width: 520, height: 720, focused: true }).then((w) => {
      windowId = w?.id;
      tabId = w?.tabs?.[0]?.id;
    }, (e) => finish(() => reject(e)));
  });
}

/** Opens the service's sign-in page and returns the token it grants. */
export async function signIn(mcpUrl: string, wwwAuthenticate: string | null): Promise<Auth> {
  const { server, scope, resource } = await discover(mcpUrl, wwwAuthenticate);
  const redirectUri = REDIRECT_URI;
  if (!server.registration_endpoint) {
    throw new Error(`${new URL(server.authorization_endpoint).host} needs an app registered in advance, which Enki cannot do for you. Use a personal access token instead.`);
  }
  const reg = await fetch(server.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "omit",
    body: JSON.stringify({
      client_name: "Enki",
      client_uri: "https://github.com/danilogiles/enkibrowser",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const client = (await reg.json().catch(() => ({}))) as { client_id?: string; client_secret?: string };
  if (!reg.ok || !client.client_id) throw new Error(`Could not register Enki with ${new URL(server.registration_endpoint).host} (${reg.status}).`);

  const { verifier, challenge } = await pkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const authUrl = new URL(server.authorization_endpoint);
  const q: Record<string, string> = {
    response_type: "code", client_id: client.client_id, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: "S256", state, resource,
  };
  if (scope) q.scope = scope;
  for (const [k, v] of Object.entries(q)) authUrl.searchParams.set(k, v);

  const answer = new URL(await signInWindow(authUrl.href));
  if (answer.searchParams.get("state") !== state) throw new Error("Sign-in answer did not match the request (state); ignored.");
  const code = answer.searchParams.get("code");
  if (!code) throw new Error(`Sign-in was refused: ${answer.searchParams.get("error_description") ?? answer.searchParams.get("error") ?? "no code"}`);

  const token = await tokenRequest(server.token_endpoint, {
    grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: verifier, resource,
  }, client.client_secret);
  return { ...token, raw: undefined, clientId: client.client_id, clientSecret: client.client_secret, tokenEndpoint: server.token_endpoint, resource } as Auth;
}

export async function refresh(auth: Auth): Promise<Auth> {
  if (!auth.refreshToken || !auth.tokenEndpoint || !auth.clientId) throw new Error("This connection's sign-in expired. Connect it again.");
  const body: Record<string, string> = { grant_type: "refresh_token", refresh_token: auth.refreshToken, client_id: auth.clientId };
  if (auth.resource) body.resource = auth.resource;
  const token = await tokenRequest(auth.tokenEndpoint, body, auth.clientSecret);
  return { ...auth, accessToken: token.accessToken, refreshToken: token.refreshToken ?? auth.refreshToken, expiresAt: token.expiresAt };
}
