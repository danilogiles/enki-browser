// Skipping AMP (#19). Loads shield/ from this checkout into Chromium with a throwaway profile,
// every host name pointed at a local HTTPS server, and checks:
//   - google.*/amp/s/… and *.cdn.ampproject.org/c/s/… go straight to the original https:// page,
//     its query kept, before the AMP address is requested;
//   - a publisher's AMP page (<html amp> or <html ⚡>) goes to its https: canonical on the same site;
//   - it stays put for a canonical on another site, an http: one, a neighbour on a shared host
//     (github.io), and a regular page that has a canonical link.
//
//   xvfb-run -a node test/shield-amp.mjs           Playwright's Chromium (npx playwright install chromium)
//   ENKI_LINUX_DIR=… xvfb-run -a node test/…        an installed Enki Browser's own Chromium
//   ENKI_CHROMIUM=/path/to/chrome …                 any Chromium that takes --load-extension
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shieldDir = path.resolve(process.env.ENKI_SHIELD_DIR ?? path.join(root, "shield"));
const enkiChrome = process.env.ENKI_LINUX_DIR && path.join(process.env.ENKI_LINUX_DIR, "chromium", "chrome");
const executablePath = process.env.ENKI_CHROMIUM ?? (enkiChrome && existsSync(enkiChrome) ? enkiChrome : chromium.executablePath());

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
async function until(fn, ms) {
  const end = Date.now() + ms;
  let last;
  do { last = await fn().catch(() => undefined); if (last) return last; await new Promise((r) => setTimeout(r, 250)); } while (Date.now() < end);
  return last;
}

// Every host name resolves to this one HTTPS server (a throwaway self-signed certificate), so
// real-looking addresses can be opened without the network.
const tmp = mkdtempSync(path.join(os.tmpdir(), "enki-shield-net-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=enki-test",
  "-keyout", path.join(tmp, "key.pem"), "-out", path.join(tmp, "cert.pem")], { stdio: "ignore" });
const seen = []; // { host, url, headers }
const server = https.createServer({ key: readFileSync(path.join(tmp, "key.pem")), cert: readFileSync(path.join(tmp, "cert.pem")) }, (req, res) => {
  seen.push({ host: req.headers.host, url: req.url, headers: req.headers });
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(page(req));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const userData = path.join(tmp, "profile");
const ctx = await chromium.launchPersistentContext(userData, {
  executablePath,
  headless: false,
  ignoreHTTPSErrors: true,
  args: [`--disable-extensions-except=${shieldDir}`, `--load-extension=${shieldDir}`, "--no-first-run", "--no-default-browser-check",
    `--host-resolver-rules=MAP * 127.0.0.1:${port}`, "--ignore-certificate-errors"],
});
const done = async () => {
  await ctx.close().catch(() => {});
  server.close();
  rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
};
const worker = async () => {
  const sw = await until(async () => ctx.serviceWorkers().find((w) => /\/background(-[0-9a-f]+)?\.js$/.test(new URL(w.url()).pathname)), 20000);
  if (!sw) throw new Error("Shield's worker did not start");
  return sw;
};

// /amp-page?canonical=…&attr=amp|⚡ is an AMP page naming that canonical; ?plain=1 a regular page.
function page(req) {
  const u = new URL(req.url, "https://x");
  const canonical = u.searchParams.get("canonical");
  if (!canonical) return "<!doctype html><title>regular</title>";
  const attr = u.searchParams.get("plain") ? "" : ` ${u.searchParams.get("attr") ?? "amp"}`;
  return `<!doctype html><html${attr}><head><title>amp</title><link rel="canonical" href="${canonical.replace(/"/g, "&quot;")}"></head><body>story</body></html>`;
}

const hosts = () => seen.map((s) => `${s.host.replace(/:\d+$/, "")}${s.url}`);
async function visit(tab, url, settle = 1500) {
  seen.length = 0;
  await tab.goto(url, { waitUntil: "load" }).catch(() => {});
  await new Promise((r) => setTimeout(r, settle)); // a redirect from the page comes after load
  return { url: tab.url(), requested: hosts() };
}

try {
  await worker();
  const tab = await ctx.newPage();

  let r = await visit(tab, "https://www.google.com/amp/s/news.example/2026/story.amp?x=1&y=2", 300);
  check("google.com/amp/s/… opens the original https:// page", r.url === "https://news.example/2026/story.amp?x=1&y=2", r.url);
  check("…without requesting the AMP address", !r.requested.some((h) => h.startsWith("www.google.com")), r.requested.join(", "));
  r = await visit(tab, "https://www.google.co.uk/amp/s/news.example/uk", 300);
  check("…and on a country's Google (google.co.uk)", r.url === "https://news.example/uk", r.url);
  r = await visit(tab, "https://news-example.cdn.ampproject.org/c/s/news.example/cached?id=7", 300);
  check("*.cdn.ampproject.org/c/s/… opens the original https:// page", r.url === "https://news.example/cached?id=7", r.url);
  check("…without requesting the cache", !r.requested.some((h) => h.includes("ampproject")), r.requested.join(", "));

  const amp = (host, canonical, extra = "") => `https://${host}/amp-page?canonical=${encodeURIComponent(canonical)}${extra}`;
  r = await visit(tab, amp("amp.pub.example", "https://www.pub.example/story"));
  check("a publisher's <html amp> page goes to its canonical on the same site", r.url === "https://www.pub.example/story", r.url);
  r = await visit(tab, amp("pub.example", "/story-2", "&attr=%E2%9A%A1"));
  check("…<html ⚡> and a relative canonical too", r.url === "https://pub.example/story-2", r.url);
  r = await visit(tab, amp("amp.pub.co.uk", "https://www.pub.co.uk/s"));
  check("…same site under a country's second level (pub.co.uk)", r.url === "https://www.pub.co.uk/s", r.url);

  const stays = async (name, url) => {
    const v = await visit(tab, url);
    check(name, v.url === url && !v.requested.some((h) => !h.startsWith(new URL(url).host)), `${v.url} ${v.requested.join(", ")}`);
  };
  await stays("a canonical on another site does not redirect (and nothing is requested from it)", amp("pub.example", "https://evil.example/story"));
  await stays("…nor one on a lookalike under another country (pub.co.uk → other.co.uk)", amp("pub.co.uk", "https://other.co.uk/s"));
  await stays("…nor an http: canonical", amp("pub.example", "http://www.pub.example/story"));
  await stays("…nor a neighbour on a shared host (alice.github.io → bob.github.io)", amp("alice.github.io", "https://bob.github.io/x"));
  await stays("…nor a regular (non-AMP) page with a canonical link", amp("pub.example", "https://www.pub.example/other", "&plain=1"));
} catch (e) {
  check("AMP", false, e.stack ?? String(e));
}
await done();
