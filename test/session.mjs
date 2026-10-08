// Closing and reopening Enki Browser, the way a person does: the tabs come back ("continue where
// you left off"), a new tab reopened at startup is Enki Home and not Chromium's page, and with
// "burn all data when I close the browser" on, nothing comes back. Started through the real
// launcher, with a throwaway profile, on each platform's built browser (as verify.mjs finds it).
//
//   node test/session.mjs                Windows: out/EnkiBrowser · Linux: ENKI_LINUX_DIR · macOS: ENKI_MAC_APP
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const linux = process.platform === "linux";
const mac = process.platform === "darwin";
const macApp = process.env.ENKI_MAC_APP ?? path.join(root, "out", `mac-${process.arch === "arm64" ? "arm64" : "x64"}`, "Enki Browser.app");
const installRoot = linux ? (process.env.ENKI_LINUX_DIR ?? path.join(root, "out", "linux", "enki-browser")) : mac ? macApp : path.join(root, "out", "EnkiBrowser");
const app = linux ? installRoot : mac ? path.join(macApp, "Contents", "Resources", "enki") : path.join(installRoot, "app", readFileSync(path.join(installRoot, "current"), "utf8").trim());
const launcher = linux ? path.join(installRoot, "enki-browser") : mac ? path.join(macApp, "Contents", "MacOS", "Enki Browser") : path.join(installRoot, "EnkiBrowser.exe");
const version = JSON.parse(readFileSync(path.join(app, "version.json"), "utf8"));
const extraArgs = [...(process.env.ENKI_NO_SANDBOX === "1" ? ["--no-sandbox"] : []), ...(process.env.ENKI_MOCK_KEYCHAIN === "1" ? ["--use-mock-keychain"] : [])];
const port = 9334;
const userData = mkdtempSync(path.join(os.tmpdir(), "enki-browser-session-"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + ms;
  let last;
  do { last = await fn().catch(() => undefined); if (last?.ok ?? last) return last; await sleep(500); } while (Date.now() < end);
  return last;
}

/** Starts the browser the way its shortcut does (no URL), and connects to it. */
async function start() {
  const proc = spawn(launcher, [`--remote-debugging-port=${port}`, ...extraArgs], { env: { ...process.env, ENKI_BROWSER_USER_DATA: userData }, stdio: "ignore" });
  let browser;
  for (let i = 0; i < 60 && !browser; i++) { await sleep(500); browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined); }
  if (!browser) throw new Error("Enki Browser did not start (no debug endpoint after 30s).");
  return { browser, proc };
}
/** Quits as the menu's Exit does, so the session is saved, and waits for the profile to be free. */
async function quit({ browser, proc }) {
  const cdp = await browser.newBrowserCDPSession();
  await cdp.send("Browser.close").catch(() => undefined);
  await browser.close().catch(() => undefined);
  await until(async () => !existsSync(path.join(userData, "SingletonLock")) && !(await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false)), 20000);
  await sleep(1500);
  proc.kill();
}
const pageUrls = async (browser) => (await (await browser.newBrowserCDPSession()).send("Target.getTargets")).targetInfos.filter((t) => t.type === "page").map((t) => t.url);

let session;
try {
  // 1. A first session: two sites and a new tab, then Exit.
  session = await start();
  let ctx = session.browser.contexts()[0];
  for (const url of ["https://example.com/", "https://example.org/"]) await (await ctx.newPage()).goto(url);
  await ctx.newPage(); // about:blank in Playwright; make it a real new tab page
  const ntp = ctx.pages().at(-1);
  await ntp.goto("chrome://newtab/").catch(() => undefined);
  await sleep(2000);
  await quit(session);

  // 2. Reopened: a new profile has "continue where you left off" from initial_preferences.
  session = await start();
  let urls = (await until(async () => { const u = await pageUrls(session.browser); return { ok: u.some((x) => x.includes("example.com")) && u.some((x) => x.includes("example.org")), u }; }, 20000))?.u ?? [];
  check("the tabs come back when the browser is reopened", urls.some((x) => x.includes("example.com")) && urls.some((x) => x.includes("example.org")), urls.join(", "));
  // The restored new tab must be Enki Home, even though it may have painted before Enki loaded.
  ctx = session.browser.contexts()[0];
  const home = await until(async () => {
    for (const p of ctx.pages()) {
      const href = await p.evaluate(() => location.href).catch(() => "");
      if (href.includes("/src/home/index.html")) return { ok: true, href };
    }
    return { ok: false, href: (await pageUrls(session.browser)).join(", ") };
  }, 25000);
  check("a new tab reopened at startup is Enki Home, not Chromium's page", !!home?.ok, home?.href ?? "");
  await quit(session);

  // 3. A profile from before this default, with no startup choice stored: the launcher's switch.
  for (const file of ["Preferences", "Secure Preferences"]) {
    const p = path.join(userData, "Default", file);
    if (!existsSync(p)) continue;
    const prefs = JSON.parse(readFileSync(p, "utf8"));
    if (prefs.session) delete prefs.session.restore_on_startup;
    writeFileSync(p, JSON.stringify(prefs));
  }
  session = await start();
  urls = (await until(async () => { const u = await pageUrls(session.browser); return { ok: u.some((x) => x.includes("example.com")), u }; }, 20000))?.u ?? [];
  // Chromium keeps no choice for this profile now, so only the launcher's switch can restore it.
  const stored = JSON.parse(readFileSync(path.join(userData, "Default", "Preferences"), "utf8")).session?.restore_on_startup;
  check("an older profile with no startup choice gets its tabs back too", stored === undefined && urls.some((x) => x.includes("example.com")), `restore_on_startup ${stored ?? "unset"} · ${urls.join(", ")}`);

  // 4. Burn when the browser closes: nothing of the last session comes back.
  ctx = session.browser.contexts()[0];
  const shield = await ctx.newPage();
  await shield.goto(`chrome-extension://${version.shieldExtensionId}/options.html`);
  await shield.evaluate(() => chrome.storage.local.set({ "shields:auto-burn": true }));
  await sleep(1000);
  await quit(session);
  session = await start();
  urls = (await until(async () => { const u = await pageUrls(session.browser); return { ok: !u.some((x) => /example\.(com|org)/.test(x)), u }; }, 25000))?.u ?? [];
  check("with burn-on-close on, the tabs do not come back", !urls.some((x) => /example\.(com|org)/.test(x)), urls.join(", "));
  await quit(session);
  session = null;
} catch (e) {
  check("suite completed", false, e instanceof Error ? e.message : String(e));
} finally {
  if (session) await quit(session).catch(() => undefined);
  try { rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { console.log(`(left temporary profile at ${userData})`); }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
