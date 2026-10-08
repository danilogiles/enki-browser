/**
 * Which URLs Enki may navigate a tab to. Shared by the Act tools (tools/executor.ts) and by
 * Receive tabs (a2a/receiver.ts), so a link an agent sends obeys the same rule as a navigation the
 * assistant makes. Never loosen: no javascript:, data:, file: or internal browser pages.
 */
const RESTRICTED_URL = /^(chrome|edge|brave|opera|vivaldi|arc|about|chrome-extension|devtools|view-source|file|javascript|data):/i;

export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  return RESTRICTED_URL.test(trimmed) || trimmed.startsWith("https://chromewebstore.google.com");
}

export function isValidWebNavigationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !isRestrictedUrl(url);
  } catch {
    return false;
  }
}
