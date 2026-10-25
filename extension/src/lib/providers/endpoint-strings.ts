/**
 * The model-address strings, copied exactly from Ink's mocks
 * (enki-brand/mobile/mocks/05-strings.json and its README). English is canonical. On desktop the
 * phone's `loopNote` is replaced by `loopNoteDesktop`. `·` is U+00B7.
 */
export const ENDPOINT_STRINGS = {
  scope: "Applies only to the model address. Websites stay HTTPS-only.",
  loopChip: "Local · on this device",
  loopNoteDesktop: "Requests stay on this computer. Nothing goes over the network.",
  toggle: "Allow HTTP for this local address",
  offNote: "HTTP is blocked until you allow it for this address.",
  warn: "Not encrypted: anyone on the same Wi-Fi can read your questions and page content.",
  httpChip: "Local · HTTP",
  revoke: "Revoke",
  refusedTitle: "Hostnames need HTTPS",
  refusedBody: "Over HTTP, Enki can't check that this name really points to your computer. Another device could take it over and read your questions.",
  refusedHint: "Use the IP address or an https:// address.",
  refusedExample: "http://192.168.1.20:11434",
  publicTitle: "Public addresses need HTTPS",
  publicBody: "HTTP is only allowed on this device or your local network.",
  keyTitle: "Can't save with an API key over HTTP",
  keyBody: "Your API key is never sent over HTTP outside this device. Use an https:// address.",
  keyHint: "If this server doesn't need a key, clear the key field.",
} as const;

/** "Revoke HTTP for 192.168.1.20:11434" (Ink's a11y label for the Revoke button). */
export const revokeLabel = (hostPort: string) => `Revoke HTTP for ${hostPort}`;

/**
 * The one-time 0.8.12 update notice (05-strings.json, mig*). {origin} is the exact scheme://host:port.
 */
const fill = (template: string) => (origin: string) => template.replace("{origin}", origin);
export const NOTICE_STRINGS = {
  migCarriedTitle: "HTTP is still on for your local model",
  migCarriedBody: fill("Enki now asks before using HTTP on your local network. It stays on for {origin} because you set it up that way."),
  migBlockedTitle: "Your model address now needs HTTPS",
  migBlockedHostBody: fill("{origin} uses HTTP with a hostname. Use the IP address or an https:// address."),
  migBlockedPublicBody: fill("{origin} uses HTTP on a public address. Use an https:// address."),
  migBlockedKeyBody: fill("{origin} uses HTTP and has an API key saved. The key stays on this device and isn't sent until you switch to https:// or clear it."),
  migOpenSettings: "Open AI model settings",
  migDismiss: "Got it",
};
