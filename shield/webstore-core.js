// "Install in Enki" for Chrome Web Store pages, the parts that need no browser: the extension id,
// the two addresses Google's update server answers on, and its update reply. Used by the worker
// (webstore.js) and test/shield-webstore-unit.mjs. Our own code, written from the public Omaha v2
// ("gupdate") protocol Chromium's extension updater speaks. Shield never opens a .crx itself:
// Chromium's installer downloads it, checks its CRX3 signature and asks.

/** An extension id: 32 letters a–p (the first 128 bits of the key's SHA-256, one letter per hex digit). */
export const ID = /^[a-p]{32}$/;
export const STORE_ORIGIN = "https://chromewebstore.google.com";
export const UPDATE_URL = "https://clients2.google.com/service/update2/crx";
/** The only hosts "Install in Enki" talks to; the request-header rule (rules/webstore.json) covers exactly these. */
export const CRX_HOSTS = ["clients2.google.com", "clients2.googleusercontent.com"];

export const isId = (id) => typeof id === "string" && ID.test(id);

/**
 * The id from a store detail page address, or null. Only the path counts:
 * /detail/<slug>/<id> or /detail/<id>, never the query, the fragment or anything on the page.
 */
export function idFromStoreUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.origin !== STORE_ORIGIN || u.username || u.password) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] !== "detail" || parts.length < 2 || parts.length > 3) return null;
  const id = parts[parts.length - 1];
  return isId(id) ? id : null;
}

/**
 * The id "Continue" installs: the one in the address Chromium reports for the sending tab, and
 * only if the card asked for that same id. A mismatch means the tab moved on (the store is a
 * single-page app) between the click and the message, or the card was not ours: refuse, rather
 * than install the extension of a page the user did not confirm.
 */
export function installId(senderUrl, claimed) {
  const id = idFromStoreUrl(senderUrl);
  if (!id) return { error: "id" };
  if (!isId(claimed) || claimed !== id) return { error: "mismatch" };
  return { id };
}

/** A Chromium version as Google's server expects it ("154.0.8037.97"), or throws. */
export function checkVersion(prodversion) {
  if (typeof prodversion !== "string" || !/^\d{1,4}(\.\d{1,5}){3}$/.test(prodversion)) throw new Error(`not a browser version: ${prodversion}`);
  return prodversion;
}

/** The address that answers with the extension's current .crx (a 302 to clients2.googleusercontent.com). */
export function crxUrl(id, prodversion) {
  if (!isId(id)) throw new Error(`not an extension id: ${id}`);
  return `${UPDATE_URL}?response=redirect&acceptformat=crx2,crx3&prodversion=${checkVersion(prodversion)}`
    + `&x=id%3D${id}%26installsource%3Dondemand%26uc`;
}

/** One update check for several extensions: [{ id, version }] → address. Only ids, versions and the browser version go out. */
export function updateCheckUrl(entries, prodversion) {
  if (!entries.length) throw new Error("nothing to check");
  const xs = entries.map(({ id, version }) => {
    if (!isId(id)) throw new Error(`not an extension id: ${id}`);
    const v = /^\d{1,9}(\.\d{1,9}){0,3}$/.test(String(version)) ? String(version) : "0.0.0.0";
    return `&x=id%3D${id}%26v%3D${v}%26uc`;
  });
  return `${UPDATE_URL}?acceptformat=crx3&prodversion=${checkVersion(prodversion)}${xs.join("")}`;
}

const attrs = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = m[3] ?? m[4];
  return out;
};

/**
 * Google's update reply (gupdate XML) → { [id]: { version, codebase } } for each app that has an
 * update ("status=ok" on <updatecheck> with a version). "noupdate", errors, unknown ids and
 * anything malformed are left out. A worker has no DOMParser, hence a small, strict reader.
 */
export function parseUpdateResponse(xml) {
  const out = {};
  if (typeof xml !== "string" || !/<gupdate[\s>]/.test(xml)) return out;
  const open = /<app\b([^>]*?)(\/?)>/g;
  for (let m; (m = open.exec(xml));) {
    if (m[2]) continue; // <app … status="error-unknownApplication"/>: nothing inside
    const end = xml.indexOf("</app>", open.lastIndex);
    if (end < 0) break;
    const body = xml.slice(open.lastIndex, end);
    open.lastIndex = end;
    const { appid } = attrs(m[1]);
    if (!isId(appid) || appid in out) continue;
    const check = /<updatecheck\b([^>]*?)\/?>/.exec(body);
    if (!check) continue;
    const a = attrs(check[1]);
    if (a.status !== "ok" || !/^\d{1,9}(\.\d{1,9}){0,3}$/.test(a.version ?? "")) continue;
    out[appid] = { version: a.version, codebase: a.codebase ?? null };
  }
  return out;
}

/** -1, 0 or 1 for dotted versions ("1.0.102" equals "1.0.102.0"). */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * The version in the file name Google's server redirects a .crx download to
 * (…/crx/blobs/…/FCOEOABG…_1_0_102_0.crx → "1.0.102.0"), when it is the extension asked for;
 * otherwise null. Read as the download starts, so Shield records a version without opening the file.
 */
export function versionFromCrxUrl(url, id) {
  if (!isId(id)) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" || !CRX_HOSTS.includes(u.hostname)) return null;
  const m = /^([a-pA-P]{32})_(\d{1,9}(?:_\d{1,9}){0,3})\.crx$/.exec(decodeURIComponent(u.pathname.split("/").pop() ?? ""));
  return m && m[1].toLowerCase() === id ? m[2].replaceAll("_", ".") : null;
}

/** The id in an install or update address of ours (x=id%3D…), or null. */
export function idFromCrxUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.origin + u.pathname !== UPDATE_URL) return null;
  const x = u.searchParams.getAll("x");
  if (x.length !== 1) return null;
  const id = new URLSearchParams(x[0]).get("id");
  return isId(id) ? id : null;
}
