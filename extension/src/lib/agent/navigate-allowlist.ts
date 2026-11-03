/**
 * "Always allow {host}" for Act's Go to / Open new tab card (#114, 0.8.15).
 *
 * The user may tick the box on a navigate card to stop being asked before Enki goes to that exact
 * host again. This is not "Auto-approve sensitive actions": mayAutoApprove() still keeps
 * cross_origin_navigation out of global auto-approve. The list only ever drops a card whose ONLY
 * category is cross_origin_navigation, for an https address, outside Incognito, that the page did
 * not ask for (see mayRememberSite in actions.ts). It never covers downloads, account pages, form
 * submits, sends, AIC-2 read_url cards, page-requested (amber) actions or anything SENSITIVE_ACTION.
 *
 * Key = exact host as shown on the card (`new URL(url).host`, lower case: hostname plus a
 * non-default port). www.reddit.com and reddit.com are different entries; no eTLD+1 grouping.
 *
 * Storage: chrome.storage.local of this profile only (never storage.sync, never sent anywhere).
 * Burn all data, Shred this site, and burn-when-the-browser-closes (Shields) DO clear this list:
 * chrome.browsingData only deletes website data, so Shield also sends Enki
 * {type:"enki:privacyWipe"} (lib/search.ts handleExternalMessage, Shield's id only), which calls
 * clearAllowedHosts(). Enki's settings, chats and API keys stay, as before.
 * Settings → Allowed sites lists it, removes one host, or clears all.
 */

export const NAVIGATE_ALLOWLIST_KEY = "enki:navigate-allowlist";
/** Bound the list so a runaway loop cannot grow storage without limit. */
export const NAVIGATE_ALLOWLIST_MAX = 500;

/**
 * The host key for a URL, or "" when the URL cannot be remembered. https only: an http page
 * (or a LAN dev server) always shows the card, because anyone on the path can stand in for it.
 */
export function allowlistHost(url: string | undefined): string {
  if (!url) return "";
  let u: URL;
  try { u = new URL(url); } catch { return ""; }
  if (u.protocol !== "https:") return "";
  if (u.username || u.password) return "";
  return u.host.toLowerCase();
}

/** Normalize one stored or typed entry; "" if it is not a valid host key. */
export function normalizeHost(entry: string): string {
  const s = (entry ?? "").trim().toLowerCase();
  if (!s || /[\s/?#@]/.test(s)) return "";
  return allowlistHost(`https://${s}/`) === s ? s : "";
}

/** Pure list ops (tested in safety-unit.cjs). */
export function addHost(list: readonly string[], host: string): string[] {
  const h = normalizeHost(host);
  const clean = sanitizeList(list);
  if (!h || clean.includes(h)) return clean;
  return [...clean, h].slice(-NAVIGATE_ALLOWLIST_MAX);
}
export function removeHost(list: readonly string[], host: string): string[] {
  const h = (host ?? "").trim().toLowerCase();
  return sanitizeList(list).filter((x) => x !== h);
}
export function sanitizeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const h = typeof x === "string" ? normalizeHost(x) : "";
    if (h && !out.includes(h)) out.push(h);
  }
  return out.slice(-NAVIGATE_ALLOWLIST_MAX);
}
export function hostAllowed(list: readonly string[], url: string | undefined): boolean {
  const h = allowlistHost(url);
  return !!h && sanitizeList(list).includes(h);
}

/**
 * Cloak nit (redirect): the step may only count as "the allowed host" if the tab actually landed
 * there. Same idea as AIC-2 redirectAllowed: compare the final address with the one approved.
 * Exact host, https only; a redirect to another host (or to http) is not that host.
 */
export function landedOnHost(approvedUrl: string | undefined, finalUrl: string | undefined): boolean {
  const a = allowlistHost(approvedUrl);
  return !!a && a === allowlistHost(finalUrl);
}

// ---------- chrome.storage.local (this profile) ----------

type StorageArea = { get(k: string): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void>; remove(k: string): Promise<void> };
function area(): StorageArea | null {
  const c = (globalThis as { chrome?: { storage?: { local?: StorageArea } } }).chrome;
  return c?.storage?.local ?? null;
}

export async function getAllowedHosts(): Promise<string[]> {
  const a = area();
  if (!a) return [];
  try { return sanitizeList((await a.get(NAVIGATE_ALLOWLIST_KEY))[NAVIGATE_ALLOWLIST_KEY]); } catch { return []; }
}
export async function isHostAllowed(url: string | undefined): Promise<boolean> {
  if (!allowlistHost(url)) return false;
  return hostAllowed(await getAllowedHosts(), url);
}
export async function allowHost(host: string): Promise<string[]> {
  const next = addHost(await getAllowedHosts(), host);
  await area()?.set({ [NAVIGATE_ALLOWLIST_KEY]: next });
  return next;
}
export async function revokeHost(host: string): Promise<string[]> {
  const next = removeHost(await getAllowedHosts(), host);
  await area()?.set({ [NAVIGATE_ALLOWLIST_KEY]: next });
  return next;
}
export async function clearAllowedHosts(): Promise<void> {
  await area()?.remove(NAVIGATE_ALLOWLIST_KEY);
}
