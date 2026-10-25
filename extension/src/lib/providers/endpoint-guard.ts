import { blockedMessage, EndpointBlockedError, evaluateEndpoint } from "./endpoint-policy";
import { ENDPOINT_STRINGS } from "./endpoint-strings";

/**
 * The request-layer half of the endpoint policy: every provider request passes through here
 * before fetch, so no code path can reach a refused endpoint or send a key over HTTP.
 */
export function assertEndpointAllowed(url: string, apiKey: string | undefined, exceptions: readonly string[] | undefined): void {
  const verdict = evaluateEndpoint(url, { hasKey: !!apiKey?.trim(), exceptions });
  if (!verdict.allowed) throw new EndpointBlockedError(verdict, blockedMessage(verdict, ENDPOINT_STRINGS));
}

/** A fetch that checks the endpoint policy for each request first and refuses redirects (given to the Anthropic SDK). */
export function guardedFetch(apiKey: string | undefined, exceptions: readonly string[] | undefined): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assertEndpointAllowed(url, apiKey, exceptions);
    // Never follow a redirect: the target would not pass through this check.
    return fetch(input, { ...init, redirect: "error" });
  };
}
