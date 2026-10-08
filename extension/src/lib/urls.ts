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

/**
 * Receive tabs (0.9): Enki's hold page carries an agent's text in its title and address (the
 * link, its label, the group title and the sender's name). That text must reach the assistant
 * only when the user asks ("Perguntar ao Enki", wrapped as untrusted data), so wherever a tab's
 * title and URL are shown to the model, a hold page is described without them.
 */
const HOLD_PAGE = /^chrome-extension:\/\/[a-p]{32}\/src\/hold\/hold\.html(?:[?#]|$)/;

export function isHoldPage(url: string | undefined): boolean {
  return !!url && HOLD_PAGE.test(url.trim());
}

export function tabForModel(tab: { title?: string; url?: string; pendingUrl?: string }): { title: string; url: string } {
  if (isHoldPage(tab.url) || isHoldPage(tab.pendingUrl)) {
    return { title: "Enki hold page", url: "(a link an agent sent, waiting for the user to click Abrir; its title and address are not shown to you)" };
  }
  return { title: tab.title ?? "", url: tab.url ?? "" };
}
