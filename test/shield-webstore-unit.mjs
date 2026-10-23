// "Install in Enki" (shield/webstore-core.js, rules/webstore.json, the manifest and the words),
// with no browser and no network: the extension id, the exact query of both Google addresses, the
// update reply, the version in a download's file name, the header rule's reach and the locales.
//
//   node test/shield-webstore-unit.mjs
//
// Also run by test/verify.mjs, so CI runs it in the Windows, Linux and macOS jobs (docs/WEBSTORE.md).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CRX_HOSTS, UPDATE_URL, compareVersions, crxUrl, idFromCrxUrl, idFromStoreUrl, installId, isId, parseUpdateResponse, updateCheckUrl, versionFromCrxUrl } from "../shield/webstore-core.js";
import { toMessage } from "../scripts/webstore-strings.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const A = "fcoeoabgfenejglbffodgkkbkcdhcgfn", B = "cjpalhdlnbpafiamejdnhcphjbkeiagm", C = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const V = "154.0.8037.97";
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** The query as [name, value] pairs, and each x= as its own pairs, in order. */
const query = (url) => {
  const u = new URL(url);
  return { base: u.origin + u.pathname, params: [...u.searchParams].map(([k, v]) => [k, k === "x" ? [...new URLSearchParams(v)] : v]) };
};

export function checkWebstoreUnit(check) {
  // ---- the id: 32 letters a–p, from the store page's path only
  check("store id: 32 letters a–p only", isId(A) && !isId(A.toUpperCase()) && !isId(A.slice(1)) && !isId(`${A}a`) && !isId(A.replace(/.$/, "q")) && !isId(A.replace(/.$/, "1")) && !isId(null) && !isId([A]));
  const pages = {
    [`https://chromewebstore.google.com/detail/some-name/${A}`]: A,
    [`https://chromewebstore.google.com/detail/${A}`]: A,
    [`https://chromewebstore.google.com/detail/some-name/${A}?hl=pt-BR#reviews`]: A,
    [`https://chromewebstore.google.com/detail/some-name/${A}/reviews`]: null,
    [`https://chromewebstore.google.com/search/${A}`]: null,
    [`https://chromewebstore.google.com/detail/some-name/${A.toUpperCase()}`]: null,
    [`https://chromewebstore.google.com/detail/x?id=${A}`]: null,
    [`https://chromewebstore.google.com/detail/x#${A}`]: null,
    [`http://chromewebstore.google.com/detail/x/${A}`]: null,
    [`https://chromewebstore.google.com.evil.example/detail/x/${A}`]: null,
    [`https://evil.example/detail/x/${A}`]: null,
    [`https://user:pw@chromewebstore.google.com/detail/x/${A}`]: null,
    [`https://chrome.google.com/webstore/detail/x/${A}`]: null,
    "not a url": null,
  };
  const wrong = Object.entries(pages).filter(([u, want]) => idFromStoreUrl(u) !== want);
  check("store id comes from the store page's path, nothing else", !wrong.length, wrong.map(([u]) => u).join(" "));

  // ---- Continue: the id the card sends must be the one in the tab's address
  const storePage = `https://chromewebstore.google.com/detail/some-name/${A}`;
  const decide = {
    "same id": [installId(storePage, A), { id: A }],
    "another valid id": [installId(storePage, B), { error: "mismatch" }],
    "no id sent": [installId(storePage, undefined), { error: "mismatch" }],
    "an id in the wrong case": [installId(storePage, A.toUpperCase()), { error: "mismatch" }],
    "an id sent as an array": [installId(storePage, [A]), { error: "mismatch" }],
    "not a store page, matching id": [installId(`https://evil.example/detail/x/${A}`, A), { error: "id" }],
    "the store's search page": [installId(`https://chromewebstore.google.com/search/${A}`, A), { error: "id" }],
  };
  const off = Object.entries(decide).filter(([, [got, want]]) => !same(got, want));
  check("Continue installs only the id that is both sent and in the tab's address", !off.length, off.map(([k, [got]]) => `${k}: ${JSON.stringify(got)}`).join("; "));

  // ---- the update switch: 38x22 drawn, a 44x44 target (popup.css); the browser test measures it
  const css = readFileSync(path.join(root, "shield", "popup.css"), "utf8");
  const base = /^\.switch \{[^}]*width: (\d+)px; height: (\d+)px/m.exec(css);
  const pad = /#cws-settings \.switch::before \{[^}]*position: absolute; inset: -(\d+)px -(\d+)px;/.exec(css);
  const tw = base && pad && Number(base[1]) + 2 * Number(pad[2]), th = base && pad && Number(base[2]) + 2 * Number(pad[1]);
  check("update switch: drawn 38x22, target at least 44x44, 2px focus ring", base?.[1] === "38" && base?.[2] === "22" && tw >= 44 && th >= 44
    && /\.switch:focus-visible \{ outline: 2px solid/.test(css), `${base?.slice(1).join("x")} → ${tw}x${th}`);

  // ---- the install address: exactly these parameters, in this order
  const install = query(crxUrl(A, V));
  check("install address: Google's update server", install.base === UPDATE_URL, install.base);
  check("install address: exactly response, acceptformat, prodversion and one x (id, installsource, uc)", same(install.params, [
    ["response", "redirect"], ["acceptformat", "crx2,crx3"], ["prodversion", V], ["x", [["id", A], ["installsource", "ondemand"], ["uc", ""]]],
  ]), JSON.stringify(install.params));
  check("install address: refuses a bad id or browser version", throws(() => crxUrl("x", V)) && throws(() => crxUrl(`${A}&x=1`, V)) && throws(() => crxUrl(A, "154")) && throws(() => crxUrl(A, "154.0.0.0&os=linux")) && throws(() => crxUrl(A, undefined)));

  // ---- the update check: prodversion, acceptformat and x=(id, v, uc) per extension, nothing else
  const update = query(updateCheckUrl([{ id: A, version: "1.0.90" }, { id: B, version: null }], V));
  check("update check: Google's update server", update.base === UPDATE_URL, update.base);
  check("update check: exactly acceptformat, prodversion and x=(id, v, uc) per extension", same(update.params, [
    ["acceptformat", "crx3"], ["prodversion", V], ["x", [["id", A], ["v", "1.0.90"], ["uc", ""]]], ["x", [["id", B], ["v", "0.0.0.0"], ["uc", ""]]],
  ]), JSON.stringify(update.params));
  const names = new Set(update.params.map(([k]) => k));
  check("update check: no os, arch, prodchannel, nacl_arch, lang or installsource", !["os", "arch", "os_arch", "prodchannel", "nacl_arch", "lang", "installsource"].some((k) => names.has(k)) && update.params.every(([k, v]) => k !== "x" || same(v.map(([n]) => n), ["id", "v", "uc"])));
  check("update check: a bad version is sent as 0.0.0.0, never as given", query(updateCheckUrl([{ id: A, version: "1.0&os=win" }], V)).params[2][1][1][1] === "0.0.0.0");
  check("update check: refuses a bad id, a bad browser version, or nothing to check", throws(() => updateCheckUrl([{ id: "x", version: "1" }], V)) && throws(() => updateCheckUrl([{ id: A, version: "1" }], "x")) && throws(() => updateCheckUrl([], V)));

  // ---- the update reply (gupdate), the shape Google answers with
  const reply = `<?xml version="1.0" encoding="UTF-8"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0" server="prod"><daystart elapsed_days="7234"/>`
    + `<app appid="${C}" status="error-unknownApplication"/>`
    + `<app appid="${A}" cohort="1::" status="ok"><updatecheck codebase="https://clients2.googleusercontent.com/crx/blobs/Q/${A.toUpperCase()}_1_0_102_0.crx" hash_sha256="00" size="1" status="ok" version="1.0.102"/></app>`
    + `<app appid="${B}" status="ok"><updatecheck status="noupdate"/></app>`
    + `<app appid="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" status="ok"><updatecheck status="ok" version="1.0&lt;x"/></app>`
    + `<app appid="NOTANID" status="ok"><updatecheck status="ok" version="2.0"/></app></gupdate>`;
  const parsed = parseUpdateResponse(reply);
  check("update reply: newer version read; noupdate, unknown, bad ids and bad versions left out", same(Object.keys(parsed), [A]) && parsed[A].version === "1.0.102" && parsed[A].codebase.endsWith("_1_0_102_0.crx"), JSON.stringify(parsed));
  check("update reply: an unknown id before a known one does not take its answer", !(C in parsed));
  check("update reply: anything that is not gupdate reads as no updates", same(parseUpdateResponse("<html>error</html>"), {}) && same(parseUpdateResponse(""), {}) && same(parseUpdateResponse(null), {}) && same(parseUpdateResponse("<gupdate><app appid=\"" + A + "\"><updatecheck status=\"ok\" version=\"1\"/>"), {}));
  check("versions compare by number", compareVersions("1.0.102", "1.0.90") > 0 && compareVersions("1.0.102", "1.0.102.0") === 0 && compareVersions("2", "10") < 0);

  // ---- the version from the download's file name, and our own addresses
  const blob = (name, host = "clients2.googleusercontent.com") => `https://${host}/crx/blobs/AbC-d_e/${name}`;
  check("download name gives the version, only for the extension asked for", versionFromCrxUrl(blob(`${A.toUpperCase()}_1_0_102_0.crx`), A) === "1.0.102.0"
    && versionFromCrxUrl(blob(`${A}_3_1.crx`), A) === "3.1"
    && versionFromCrxUrl(blob(`${B.toUpperCase()}_1_0.crx`), A) === null
    && versionFromCrxUrl(blob(`${A.toUpperCase()}_1_0.crx`, "evil.example"), A) === null
    && versionFromCrxUrl(blob(`${A.toUpperCase()}_1_x.crx`), A) === null
    && versionFromCrxUrl(blob(`${A.toUpperCase()}_1_0.zip`), A) === null
    && versionFromCrxUrl("http://clients2.googleusercontent.com/crx/blobs/x/" + `${A}_1.crx`, A) === null);
  check("our own install and update addresses are recognised, nothing else", idFromCrxUrl(crxUrl(A, V)) === A && idFromCrxUrl(updateCheckUrl([{ id: B, version: "1" }], V)) === B
    && idFromCrxUrl(updateCheckUrl([{ id: A, version: "1" }, { id: B, version: "1" }], V)) === null
    && idFromCrxUrl(`https://evil.example/service/update2/crx?x=id%3D${A}`) === null && idFromCrxUrl("nope") === null);

  // ---- the header rule reaches the two Google download hosts and nothing else
  const rules = JSON.parse(readFileSync(path.join(root, "shield", "rules", "webstore.json"), "utf8"));
  const rule = rules[0];
  const removed = (list) => (list ?? []).filter((h) => h.operation === "remove").map((h) => h.header.toLowerCase()).sort();
  check("header rule: one rule, on clients2.google.com and clients2.googleusercontent.com only", rules.length === 1 && same([...rule.condition.requestDomains].sort(), [...CRX_HOSTS].sort()) && same(CRX_HOSTS, ["clients2.google.com", "clients2.googleusercontent.com"])
    && Object.keys(rule.condition).every((k) => ["requestDomains", "resourceTypes"].includes(k)), JSON.stringify(rule.condition));
  check("header rule: removes Cookie, Referer and X-Client-Data, and Set-Cookie from the answer", rule.action.type === "modifyHeaders" && same(removed(rule.action.requestHeaders), ["cookie", "referer", "x-client-data"]) && same(removed(rule.action.responseHeaders), ["set-cookie"]));
  check("header rule: covers the tab's download, Shield's own requests and Chromium's", ["main_frame", "xmlhttprequest", "other"].every((t) => rule.condition.resourceTypes.includes(t)));

  // ---- the manifest: the store page and the rule, no new permission
  const manifest = JSON.parse(readFileSync(path.join(root, "shield", "manifest.json"), "utf8"));
  check("manifest: no management and no downloads permission; the permission list is unchanged", same(manifest.permissions, ["declarativeNetRequest", "webNavigation", "webRequest", "tabs", "storage", "alarms", "contentSettings", "browsingData", "nativeMessaging", "contextMenus", "scripting"]) && same(manifest.host_permissions, ["<all_urls>"]) && !("optional_permissions" in manifest), JSON.stringify(manifest.permissions));
  const store = manifest.content_scripts.find((c) => c.js.includes("webstore-page.js"));
  check("manifest: the store button runs on chromewebstore.google.com only", same(store?.matches, ["https://chromewebstore.google.com/*"]) && !store.all_frames, JSON.stringify(store));
  check("manifest: the header rule is on from the start", manifest.declarative_net_request.rule_resources.some((r) => r.id === "webstore" && r.enabled && r.path === "rules/webstore.json"));

  // ---- the words: Ink's keys in every locale, with the same placeholders
  const loc = path.join(root, "shield", "_locales");
  const en = JSON.parse(readFileSync(path.join(loc, "en", "messages.json"), "utf8"));
  const inkKeys = Object.keys(en).filter((k) => /^(cws_|access_|native_label|settings_|update_)/.test(k));
  const used = new Set();
  for (const f of ["webstore-page.js", "webstore-ui.js", "options.html"]) for (const m of readFileSync(path.join(root, "shield", f), "utf8").matchAll(/["'(]((?:cws|access|settings|update)_[a-z_]+)["')]/g)) used.add(m[1]);
  check("words: every key the button and settings use is in English", [...used].every((k) => k in en), [...used].filter((k) => !(k in en)).join(", "));
  const bad = [];
  for (const lang of readdirSync(loc)) {
    const m = JSON.parse(readFileSync(path.join(loc, lang, "messages.json"), "utf8"));
    for (const k of inkKeys) {
      if (!m[k]) { bad.push(`${lang}:${k} missing`); continue; }
      if (!same(Object.keys(m[k].placeholders ?? {}), Object.keys(en[k].placeholders ?? {}))) bad.push(`${lang}:${k} placeholders`);
      for (const p of m[k].message.matchAll(/\$(\w+)\$/g)) if (!m[k].placeholders?.[p[1].toLowerCase()]) bad.push(`${lang}:${k} $${p[1]}$`);
      if (/\{\w+\}/.test(m[k].message)) bad.push(`${lang}:${k} unconverted {…}`);
    }
  }
  check("words: Ink's keys in every locale with matching placeholders", inkKeys.length >= 31 && !bad.length, bad.slice(0, 6).join(", ") || `${inkKeys.length} keys`);
  const two = toMessage("{from} → {to}", "{from} → {to}");
  check("words: {name}/{from}/{to} become Chrome placeholders", two.message === "$FROM$ → $TO$" && two.placeholders.from.content === "$1" && two.placeholders.to.content === "$2" && throws(() => toMessage("{who}", "{name}")));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = [];
  checkWebstoreUnit((name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`); });
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
