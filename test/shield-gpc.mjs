// Global Privacy Control (#18). Loads shield/ from this checkout into Chromium with a throwaway
// profile, every host name pointed at a local HTTPS server, and checks:
//   - Sec-GPC: 1 arrives with the page, with a cross-site iframe and with their subresources;
//   - navigator.globalPrivacyControl is true in the page and in the iframe, before page scripts run;
//   - Shields' settings has the switch, on by default; off removes both halves, on brings them back.
//
//   xvfb-run -a node test/shield-gpc.mjs           Playwright's Chromium (npx playwright install chromium)
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

function page(req) {
  // Each document records what navigator said while it was being parsed, before any other script.
  const early = "<script>window.early = navigator.globalPrivacyControl;</script>";
  if (req.url.startsWith("/main")) return `<!doctype html><title>t</title>${early}<img src="/pixel.gif"><iframe src="https://frame.test/embed"></iframe>`;
  if (req.url.startsWith("/embed")) return `<!doctype html><title>f</title>${early}<img src="/frame-pixel.gif">`;
  return "";
}

const gpcOf = (host, url) => [...seen].reverse().find((s) => s.host.startsWith(host) && s.url.startsWith(url))?.headers["sec-gpc"];
async function open(tab) {
  seen.length = 0;
  await tab.goto("https://site.example/main");
  await until(async () => seen.some((s) => s.url === "/frame-pixel.gif"), 5000);
  const frame = await until(async () => tab.frames().find((f) => f.url().includes("frame.test")), 5000);
  const read = (f) => f.evaluate(() => [navigator.globalPrivacyControl, window.early]);
  return { main: await read(tab.mainFrame()), frame: frame ? await read(frame) : [] };
}

try {
  const sw = await worker();
  const id = new URL(sw.url()).host;
  await until(() => sw.evaluate(async () => { await globalThis.enkiShieldGpc?.ready(); return (await chrome.scripting.getRegisteredContentScripts()).length > 0; }), 10000);
  const tab = await ctx.newPage();

  let r = await open(tab);
  check("Sec-GPC: 1 is sent with the page", gpcOf("site.example", "/main") === "1", String(gpcOf("site.example", "/main")));
  check("…with its subresources", gpcOf("site.example", "/pixel.gif") === "1");
  check("…with a cross-site iframe", gpcOf("frame.test", "/embed") === "1");
  check("…and with the iframe's subresources", gpcOf("frame.test", "/frame-pixel.gif") === "1");
  check("navigator.globalPrivacyControl is true in the page, before its scripts run", r.main[0] === true && r.main[1] === true, JSON.stringify(r.main));
  check("…and in the iframe", r.frame[0] === true && r.frame[1] === true, JSON.stringify(r.frame));

  const settings = await ctx.newPage();
  await settings.goto(`chrome-extension://${id}/options.html`);
  const sw0 = await until(async () => settings.evaluate(() => document.getElementById("gpc")?.getAttribute("aria-checked")), 5000);
  check("Shields' settings has the switch, on by default", sw0 === "true", String(sw0));
  await settings.click("#gpc");
  await until(() => sw.evaluate(async () => { await globalThis.enkiShieldGpc.ready(); return !(await chrome.declarativeNetRequest.getDynamicRules()).some((x) => x.id === 3); }), 5000);
  r = await open(tab);
  check("turned off: no Sec-GPC header", gpcOf("site.example", "/main") === undefined && gpcOf("frame.test", "/embed") === undefined);
  check("…and no navigator.globalPrivacyControl", r.main[0] !== true && r.frame[0] !== true, JSON.stringify(r));
  await settings.click("#gpc");
  await until(() => sw.evaluate(async () => { await globalThis.enkiShieldGpc.ready(); return (await chrome.declarativeNetRequest.getDynamicRules()).some((x) => x.id === 3); }), 5000);
  await settings.reload();
  check("turned on again, and the switch says so after a reload", (await settings.evaluate(() => document.getElementById("gpc").getAttribute("aria-checked"))) === "true");
  r = await open(tab);
  check("…both halves are back", gpcOf("site.example", "/main") === "1" && r.main[0] === true && r.frame[0] === true, JSON.stringify(r));

  // Session storage holds the Shields panel's per-tab count (shields.js), as before; GPC adds nothing.
  const stored = await sw.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  check("no site is stored", !/site\.example|frame\.test/.test(stored));
} catch (e) {
  check("global privacy control", false, e.stack ?? String(e));
}
await done();
