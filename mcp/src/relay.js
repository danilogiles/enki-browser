// Transport to the relay: one HTTPS POST per packet, nothing else. The relay keeps the ciphertext
// until Enki fetches it or 10 minutes pass. Its answer carries no read receipt, and we never ask.

// TODO(Blink): align the path with the relay prototype once its API is published.
export function mailboxUrl(relayUrl, mailbox) {
  return `${relayUrl}/v1/mailbox/${encodeURIComponent(mailbox)}`;
}

export async function postToRelay({ relayUrl, mailbox, wire, fetchImpl = fetch, timeoutMs = 10_000 }) {
  let res;
  try {
    res = await fetchImpl(mailboxUrl(relayUrl, mailbox), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: wire,
      // A redirect could send the packet somewhere the user did not configure.
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const reason = e?.name === "TimeoutError" ? "timed out" : "could not be reached";
    return { ok: false, message: `The relay ${reason}.` };
  }
  // Drain the body without reading it into anything.
  await res.arrayBuffer().catch(() => {});
  if (res.ok) return { ok: true, status: res.status };
  return { ok: false, status: res.status, message: `The relay refused the packet (HTTP ${res.status}).` };
}
