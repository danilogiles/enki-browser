/**
 * Profiles created by 0.7.2 through 0.8.7 got the panel as the address bar's search engine
 * (config/initial_preferences.json), so typed searches went to the user's AI provider without
 * them choosing it. The panel opened with ?q= is how such a search arrives; it shows a card
 * explaining that and how to switch back to DuckDuckGo.
 */
export const KEEP_KEY = "enki:legacySearchKept";
export const SEARCH_SETTINGS_URL = "chrome://settings/searchEngines";

export function ddgUrl(q: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
}

/**
 * Incognito: the query goes straight to DuckDuckGo, before anything renders, before settings or
 * storage are read, and before any request to the model. Nothing is saved as a chat.
 * Returns the URL to replace the page with, or null to render normally.
 */
export function incognitoRedirect(search: string, inIncognito: boolean): string | null {
  if (!inIncognito) return null;
  const q = new URLSearchParams(search).get("q")?.trim();
  return q ? ddgUrl(q) : null;
}
