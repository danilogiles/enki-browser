// Tests EnkiBrowserSetup.exe from the last build in out/: a fresh install, a migration from the
// 0.1–0.4 layout, the installed browser starting, and the uninstaller. Uses /NoIntegration so it
// never touches the Start menu, desktop or Apps entry of a real install on this machine.
//
//   npm run build && node test/setup.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setup = path.join(root, "out", readdirSync(path.join(root, "out")).find((f) => /^EnkiBrowserSetup-.*\.exe$/.test(f)));
const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "enki-setup-test-")));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (exe, args, env = {}) => new Promise((resolve) => {
  const p = spawn(exe, args, { env: { ...process.env, ...env }, stdio: "ignore" });
  p.on("exit", resolve);
});
const layoutOk = (dir) => {
  const v = existsSync(path.join(dir, "current")) ? readFileSync(path.join(dir, "current"), "utf8").trim() : "";
  return !!v && existsSync(path.join(dir, "EnkiBrowser.exe")) && existsSync(path.join(dir, "app", v, "EnkiBrowserLauncher.exe"))
    && existsSync(path.join(dir, "app", v, "chromium", "chrome.exe"));
};

try {
  // ---- fresh install
  const fresh = path.join(tmp, "fresh");
  const code = await run(setup, ["/S", `/D=${fresh}`, "/NoIntegration"]);
  check("a silent install succeeds and lays out stub, current and app\\<version>", code === 0 && layoutOk(fresh), `exit ${code}`);

  const userData = path.join(tmp, "profile");
  run(path.join(fresh, "EnkiBrowser.exe"), ["--remote-debugging-port=9461", "about:blank"], { ENKI_BROWSER_USER_DATA: userData, ENKI_BROWSER_NO_UPDATE: "1" });
  let browser;
  for (let i = 0; i < 60 && !browser; i++) { await sleep(500); browser = await chromium.connectOverCDP("http://127.0.0.1:9461").catch(() => undefined); }
  const product = browser ? (await (await browser.newBrowserCDPSession()).send("Browser.getVersion")).product : "";
  check("the installed browser starts", /Chrome\//.test(product), product || "no browser");
  if (browser) { await (await browser.newBrowserCDPSession()).send("Browser.close").catch(() => {}); await browser.close().catch(() => {}); }
  await sleep(3000);

  // ---- migrating a 0.1–0.4 install: the old files go, the profile stays
  const legacy = path.join(tmp, "legacy");
  for (const d of ["chromium", "extensions", "config", ".previous", ".update", "User Data"]) mkdirSync(path.join(legacy, d), { recursive: true });
  for (const f of ["chromium/chrome.exe", "install.ps1", "uninstall.ps1", "Install Enki Browser.cmd", "version.json", "EnkiBrowser.exe"]) writeFileSync(path.join(legacy, f), "old");
  writeFileSync(path.join(legacy, "User Data", "marker"), "keep me");
  const code2 = await run(setup, ["/S", `/D=${legacy}`, "/NoIntegration"]);
  const leftovers = ["install.ps1", "uninstall.ps1", "Install Enki Browser.cmd", "version.json", ".previous", "chromium"].filter((f) => existsSync(path.join(legacy, f)));
  check("installing over the old layout removes its files", code2 === 0 && layoutOk(legacy) && leftovers.length === 0, leftovers.join(", ") || "clean");
  check("the old layout's portable profile is kept", existsSync(path.join(legacy, "User Data", "marker")));

  // ---- uninstall: runs from a temp copy, so it can remove its own folder
  await run(path.join(fresh, "EnkiBrowser.exe"), ["--uninstall", "/S", "/NoIntegration"]);
  for (let i = 0; i < 40 && existsSync(fresh); i++) await sleep(500);
  check("the uninstaller removes the whole install", !existsSync(fresh));
} catch (e) {
  console.log(`ERROR ${e.message}`);
  results.push({ name: "no unexpected error", ok: false });
} finally {
  await sleep(1000);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { console.log(`(left ${tmp})`); }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
