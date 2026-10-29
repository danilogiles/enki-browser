/**
 * AIC-2 (Enki 0.8.14): the words for read_url's confirm cards and refusals. English is canonical
 * and still draft copy for Ink (polish) and Cloak (claims). Keys are stable: tests match on them,
 * so change the text freely but keep the keys. `{host}` / `{url}` are filled in by the helpers below.
 */
export const READ_URL_STRINGS = {
  // Confirm card: a page on this computer (localhost, 127.0.0.1, [::1], *.localhost, 0.0.0.0).
  localDeviceVerb: "Read a page on this computer",
  // Confirm card: a page on the local network (192.168.x.x, 10.x, 172.16-31.x, 169.254.x,
  // 100.64/10, fc00::/7, fe80::/10, *.local, *.lan, *.internal, single-word names like "router").
  localNetworkVerb: "Read a page on your local network",
  localWhy: "You didn't name this address. Pages here can hold private data, like your router, NAS or work tools.",
  // Confirm card: a read_url the model chose after reading web content this chat.
  untrustedVerb: (host: string) => `Read ${host}`,
  untrustedWhy: "Enki picked this address after reading web content. Anything in the address is sent to that site.",
  // Value-row labels (the card splits each row on ": ").
  rowAddress: "Address",
  rowWhy: "Why",
  // Errors the model (and the step chip) sees. Not a card.
  redirectedLocal: (host: string) =>
    `Stopped: the page redirected to ${host}, an address on this computer or your local network. Enki doesn't follow redirects there. Ask the user to name that address if they want it read.`,
  noCookielessTab:
    "This page needs JavaScript to read, and Enki could not open it without your cookies, so it was not opened.",
} as const;
