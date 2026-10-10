// Protected video (Widevine), turned on from Shields' settings, against a local stand-in for
// Google's update service. The package it serves is built from the Widevine module of the Google
// Chrome installed on this machine (GitHub's Windows runners have one), so the module carries
// Google's real signature; nothing of Google's is in the repository.
//
// Runs a test build of the launcher (ENKI_TEST) in a copy of out/EnkiBrowser; see below.
//
// Checks: a package whose hash differs from the service's answer is refused; a module not signed by
// Google is refused; the genuine one installs into <User Data>\WidevineCdm\<version>; turning it off
// removes it; and in the browser, "Turn on" → "Download from Google" → restart makes the browser
// offer Widevine to pages (navigator.requestMediaKeySystemAccess), which it did not before.
//
//   node test/widevine.mjs            Windows, after npm run build (out/EnkiBrowser)
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32") { console.log("SKIP protected video is Windows-only for now"); process.exit(0); }
const chromeApp = "C:\\Program Files\\Google\\Chrome\\Application";
const cdmDir = existsSync(chromeApp) && readdirSync(chromeApp).map((v) => path.join(chromeApp, v, "WidevineCdm")).find((d) => existsSync(path.join(d, "manifest.json")));
if (!cdmDir) { console.log("SKIP no Google Chrome with a Widevine module on this machine to build a package from"); process.exit(0); }

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const tmp = mkdtempSync(path.join(os.tmpdir(), "enki-widevine-"));

// ---- packages: CRX3 = "Cr24", version 3, header length, header, zip
const version = JSON.parse(readFileSync(path.join(cdmDir, "manifest.json"), "utf8")).version;
const crx3 = (dir) => {
  const zip = path.join(tmp, `pkg-${Date.now()}.zip`);
  // Windows' own tar (bsdtar) writes zip; a GNU tar earlier on PATH (Git Bash) would not.
  execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", zip, "-C", dir, "."]);
  const header = Buffer.alloc(32, 7);
  const head = Buffer.alloc(12);
  head.write("Cr24", 0, "ascii"); head.writeUInt32LE(3, 4); head.writeUInt32LE(header.length, 8);
  return Buffer.concat([head, header, readFileSync(zip)]);
};
const genuine = crx3(cdmDir);
const forgedDir = path.join(tmp, "forged");
cpSync(cdmDir, forgedDir, { recursive: true });
// The same files, but a module Google never signed: a copy of an unsigned program would do; the
// manifest stays, so only the signature check can catch it.
writeFileSync(path.join(forgedDir, "_platform_specific", "win_x64", "widevinecdm.dll"), Buffer.concat([readFileSync(path.join(cdmDir, "_platform_specific", "win_x64", "widevinecdm.dll")).subarray(0, 4096), Buffer.alloc(4096)]));
const unsigned = crx3(forgedDir);

// ---- the stand-in for update.googleapis.com
let serving = { body: genuine, hash: sha(genuine) };
const server = http.createServer((req, res) => {
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const asked = JSON.parse(body).request.app[0].appid;
      res.end(")]}'\n" + JSON.stringify({ response: { protocol: "3.1", app: [{ appid: asked, status: "ok", updatecheck: { status: "ok",
        urls: { url: [{ codebase: `${base}/pkg/` }] },
        manifest: { version, packages: { package: [{ name: "widevine.crx3", hash_sha256: serving.hash, size: serving.body.length }] } } } }] } }));
    });
    return;
  }
  if (req.url === "/pkg/widevine.crx3") return res.end(serving.body);
  res.statusCode = 404; res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// A release launcher only ever asks Google, over HTTPS (launcher/WidevineTrust.cs). The stand-in
// needs a test launcher: a copy of the built install whose EnkiBrowserLauncher.exe is recompiled
// with ENKI_TEST, which reads ENKI_WIDEVINE_SERVICE (HTTPS, or HTTP to this computer only). out/
// itself is left as built, so nothing compiled for tests can reach a release artifact.
const built = path.join(root, "out", "EnkiBrowser");
const install = path.join(tmp, "EnkiBrowser");
cpSync(built, install, { recursive: true });
const appDir = path.join(install, "app", readFileSync(path.join(install, "current"), "utf8").trim());
{
  const windir = process.env.WINDIR ?? "C:\\Windows";
  const csc = ["Framework64", "Framework"].map((f) => path.join(windir, "Microsoft.NET", f, "v4.0.30319", "csc.exe")).find(existsSync);
  if (!csc) throw new Error("The .NET Framework C# compiler (csc.exe) was not found.");
  // The update key is left empty: the test launcher can never accept an update (Updater fails closed).
  const buildInfo = path.join(tmp, "BuildInfo.g.cs");
  writeFileSync(buildInfo, 'static class UpdateKey { public const string Modulus = ""; public const string Exponent = ""; }\n');
  const src = ["Launcher.cs", "Updater.cs", "NativeHost.cs", "Widevine.cs", "WidevineTrust.cs", "Migration.cs", "Watcher.cs", "ShellIdentity.cs", "Args.cs", "Common.cs", "Install.cs", "DefaultBrowser.cs"].map((f) => path.join(root, "launcher", f));
  const refs = ["System.Windows.Forms.dll", "System.Drawing.dll", "System.Core.dll", "Microsoft.CSharp.dll", "System.Web.Extensions.dll", "System.IO.Compression.dll", "System.IO.Compression.FileSystem.dll"];
  execFileSync(csc, ["/nologo", "/target:winexe", "/platform:x64", "/define:ENKI_TEST", ...refs.map((r) => `/r:${r}`), `/out:${path.join(appDir, "EnkiBrowserLauncher.exe")}`, ...src, buildInfo], { stdio: "inherit" });
}
const shieldId = JSON.parse(readFileSync(path.join(appDir, "version.json"), "utf8")).shieldExtensionId;
const env = (userData) => ({ ...process.env, ENKI_BROWSER_USER_DATA: userData, ENKI_WIDEVINE_SERVICE: `${base}/service` });

/** One native-messaging request to the launcher, as Chromium makes it. */
const ask = (userData, message) => new Promise((resolve, reject) => {
  const p = spawn(path.join(appDir, "EnkiBrowserLauncher.exe"), [`chrome-extension://${shieldId}/`], { env: env(userData) });
  const chunks = [];
  p.stdout.on("data", (c) => chunks.push(c));
  p.on("error", reject);
  p.on("exit", () => {
    const out = Buffer.concat(chunks);
    resolve(out.length > 4 ? JSON.parse(out.subarray(4, 4 + out.readUInt32LE(0)).toString("utf8")) : null);
  });
  const data = Buffer.from(JSON.stringify(message));
  const len = Buffer.alloc(4); len.writeUInt32LE(data.length);
  p.stdin.end(Buffer.concat([len, data]));
});

// The install registers itself as the native host for this Windows user; put back what was there.
const hostKey = "HKCU\\Software\\Chromium\\NativeMessagingHosts\\io.github.danilogiles.enki_browser";
const hostBefore = (() => { try { return /REG_SZ\s+(.+)$/m.exec(execFileSync("reg", ["query", hostKey, "/ve"], { stdio: ["ignore", "pipe", "ignore"] }).toString())?.[1].trim() ?? null; } catch { return null; } })();
const restoreHost = () => {
  try {
    if (hostBefore) execFileSync("reg", ["add", hostKey, "/ve", "/d", hostBefore, "/f"], { stdio: "ignore" });
    else execFileSync("reg", ["delete", hostKey, "/f"], { stdio: "ignore" });
  } catch { /* nothing registered either way */ }
};

let browser;
const start = async (userData, port) => {
  spawn(path.join(install, "EnkiBrowser.exe"), [`--remote-debugging-port=${port}`, "about:blank"], { env: env(userData), stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
    if (b) return b;
  }
  throw new Error("browser did not start");
};
const quit = async (b) => {
  await (await b.newBrowserCDPSession()).send("Browser.close").catch(() => undefined);
  await b.close().catch(() => undefined);
  await sleep(4000);
};
const drm = (page) => page.evaluate(async () => {
  try {
    const access = await navigator.requestMediaKeySystemAccess("com.widevine.alpha", [{ initDataTypes: ["cenc"], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"', robustness: "SW_SECURE_CRYPTO" }] }]);
    return !!(await access.createMediaKeys());
  } catch { return false; }
});

try {
  // ---- the launcher alone (native messaging, no browser)
  const data = path.join(tmp, "host");
  check("off at first: nothing installed", (await ask(data, { type: "widevine-status" }))?.installed === null);

  serving = { body: genuine, hash: "0".repeat(64) };
  let r = await ask(data, { type: "widevine-install" });
  check("a package whose hash differs from Google's answer is refused", /does not match/.test(r?.error ?? "") && !existsSync(path.join(data, "WidevineCdm", version)), r?.error);

  serving = { body: unsigned, hash: sha(unsigned) };
  r = await ask(data, { type: "widevine-install" });
  check("a module not signed by Google is refused", /not validly signed by Google/.test(r?.error ?? "") && !existsSync(path.join(data, "WidevineCdm", version)), r?.error);

  serving = { body: genuine, hash: sha(genuine) };
  r = await ask(data, { type: "widevine-install" });
  check("the genuine module installs into WidevineCdm\\<version>", r?.installed === version && r?.managed === true
    && existsSync(path.join(data, "WidevineCdm", version, "_platform_specific", "win_x64", "widevinecdm.dll")), JSON.stringify(r));

  r = await ask(data, { type: "widevine-remove" });
  check("turning it off removes it", r?.installed === null && !existsSync(path.join(data, "WidevineCdm", version)), JSON.stringify(r));

  // ---- in the browser, from Shields' settings
  const profile = path.join(tmp, "browser");
  browser = await start(profile, 9461);
  let page = await browser.contexts()[0].newPage();
  await page.goto("https://example.com/");
  check("before: pages are not offered Widevine", (await drm(page)) === false);
  const settings = await browser.contexts()[0].newPage();
  await settings.goto(`chrome-extension://${shieldId}/options.html`);
  await settings.waitForFunction(() => document.documentElement.dataset.widevine === "ready", null, { timeout: 15000 });
  await settings.click("#widevine-on");
  const asked = await settings.evaluate(() => !document.getElementById("widevine-consent").hidden);
  check("Turn on first says what Widevine is and where it comes from", asked && /Google/.test(await settings.textContent("#widevine-consent")));
  await settings.click("#widevine-go");
  const offered = await settings.waitForFunction(() => !document.getElementById("widevine-restart").hidden, null, { timeout: 120000 }).then(() => true, () => false);
  check("Download from Google installs it and offers a restart", offered, (await settings.textContent("#widevine-state"))?.trim());
  await quit(browser);

  browser = await start(profile, 9462);
  page = await browser.contexts()[0].newPage();
  await page.goto("https://example.com/");
  check("after the restart, pages are offered Widevine", await drm(page));
  const again = await browser.contexts()[0].newPage();
  await again.goto(`chrome-extension://${shieldId}/options.html`);
  await again.waitForFunction(() => document.documentElement.dataset.widevine === "ready", null, { timeout: 15000 });
  check("Shields' settings show it on", /^On · Widevine/.test((await again.textContent("#widevine-state"))?.trim() ?? ""), (await again.textContent("#widevine-state"))?.trim());
  await quit(browser);
  browser = null;
} catch (e) {
  check("suite completed", false, e instanceof Error ? e.message : String(e));
} finally {
  if (browser) await quit(browser).catch(() => undefined);
  restoreHost();
  server.close();
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", `Get-Process chrome,EnkiBrowserLauncher -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${install}\\*' } | Stop-Process -Force`], { stdio: "ignore" });
  } catch { /* nothing left */ }
  await sleep(1000);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { console.log(`(left ${tmp})`); }
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
