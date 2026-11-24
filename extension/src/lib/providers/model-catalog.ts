/** Catalog entries are untrusted suggestions, never proof of protocol access. */
export type CatalogModel = { id: string; realtime?: "reported" | "name-hint"; input?: string[]; output?: string[] };
const clean = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 512 && !/[\x00-\x1f\x7f]/.test(x);
const strings = (x: unknown): string[] => Array.isArray(x) ? x.filter(clean).slice(0, 32) : [];
export function normalizeCatalog(rows: unknown): CatalogModel[] {
  if (!Array.isArray(rows)) throw new Error("Invalid model catalog");
  if (rows.length > 50000) throw new Error("Model catalog too large; enter model manually");
  const models = new Map<string, CatalogModel>();
  for (const row of rows) {
    const m = typeof row === "string" ? { id: row } : row;
    if (!m || !clean(m.id)) continue;
    const endpoints = strings(m.endpoints ?? m.supported_endpoints);
    const reported = m.realtime === true || m.realtime === "reported" || endpoints.some((p) => /^(?:\/?v1\/)?realtime(?:\/calls)?$/.test(p));
    const hint = /(?:^|[-_/])realtime(?:$|[-_/])|(?:^|[-_/])gpt-live(?:$|[-_/])/i.test(m.id);
    models.set(m.id, { id: m.id, realtime: reported ? "reported" : hint ? "name-hint" : undefined,
      input: strings(m.architecture?.input_modalities ?? m.input), output: strings(m.architecture?.output_modalities ?? m.output) });
  }
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}
/** Bound allocation before parsing; no arbitrary pagination links are followed. */
export async function readCatalogJson(response: Response): Promise<any> {
  if (!response.body) throw new Error("Empty catalog response");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("Catalog response too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
/** No endpoint guessing for arbitrary custom services, audio models or GPT-Live. */
export function suggestedRealtimeEndpoint(base: string, id: string): string {
  try { const u = new URL(base);
    return u.origin === "https://api.openai.com" && u.pathname.replace(/\/+$/, "") === "/v1" && !u.search && !u.hash && !u.username && !u.password && /(?:^|[-_/])realtime(?:$|[-_/])/i.test(id)
      ? "https://api.openai.com/v1/realtime/calls" : "";
  } catch { return ""; }
}
export function sameCredentialOrigin(base: string, endpoint: string): boolean {
  try { const a = new URL(base), b = new URL(endpoint);
    return a.protocol === "https:" && b.protocol === "https:" && a.origin === b.origin && ![a, b].some((u) => u.username || u.password || u.search || u.hash);
  } catch { return false; }
}

// Memory-only, bounded TTL cache. Neither raw keys nor catalogs are persisted/logged.
const catalogs = new Map<string, { at: number; list: CatalogModel[] }>();
export async function catalogIdentity(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function cachedCatalog(id: string, now = Date.now()): CatalogModel[] | undefined {
  const hit = catalogs.get(id);
  if (!hit || now - hit.at >= 300000) { catalogs.delete(id); return; }
  return hit.list;
}
export function cacheCatalog(id: string, list: CatalogModel[], now = Date.now()): void {
  catalogs.delete(id); catalogs.set(id, { at: now, list });
  while (catalogs.size > 4) catalogs.delete(catalogs.keys().next().value!);
}
