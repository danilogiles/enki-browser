// Tests EnkiBrowserSetup.exe from the last build in out/: a fresh install, a migration from the
// 0.1–0.4 layout, the installed browser starting, and the uninstaller. Uses /NoIntegration so it
// never touches the Start menu, desktop or Apps entry of a real install on this machine.
//
//   npm run build && node test/setup.mjs
import { spawn, spawnSync } from "node:child_process";
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

  // Opened the way Windows opens a link with the registered command ("<stub>" --single-argument %1,
  // %1 replaced by the text as it is, unquoted): a hostile one whose pieces look like switches.
  const userData = path.join(tmp, "profile");
  const link = 'https://example.com/?q="a b" --gpu-launcher=calc --utility-cmd-prefix=calc';
  const stub = path.join(fresh, "EnkiBrowser.exe");
  spawn(stub, ["--remote-debugging-port=9461", "--enable-automation", "--single-argument", link], {
    argv0: `"${stub}"`, windowsVerbatimArguments: true, stdio: "ignore", // joined with spaces, nothing quoted
    env: { ...process.env, ENKI_BROWSER_USER_DATA: userData, ENKI_BROWSER_NO_UPDATE: "1" },
  });
  let browser;
  for (let i = 0; i < 60 && !browser; i++) { await sleep(500); browser = await chromium.connectOverCDP("http://127.0.0.1:9461").catch(() => undefined); }
  const cdp = browser ? await browser.newBrowserCDPSession() : null;
  const product = cdp ? (await cdp.send("Browser.getVersion")).product : "";
  check("the installed browser starts", /Chrome\//.test(product), product || "no browser");
  // What Chromium parsed (needs --enable-automation), and the command line chrome.exe really got.
  const argv = cdp ? (await cdp.send("Browser.getBrowserCommandLine").catch(() => ({ arguments: [] }))).arguments : [];
  const injected = argv.filter((a) => /^--(gpu-launcher|utility-cmd-prefix)/.test(a));
  check("a link opened through the stub reaches Chromium as one literal argument, never as switches",
    argv.includes(link) && injected.length === 0, injected.length ? `parsed as switches: ${injected.join(" ")}` : argv.slice(-3).join(" | "));
  const ps = spawnSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { $_.CommandLine }"], { encoding: "utf8" });
  const line = (ps.stdout ?? "").split(/\r?\n/).find((l) => l.includes(fresh) && !l.includes("--type=")) ?? "";
  check("chrome.exe's command line ends with --single-argument and the link, unchanged", line.trimEnd().endsWith(` --single-argument ${link}`), line.slice(-160));
  const tabs = cdp ? (await cdp.send("Target.getTargets")).targetInfos.filter((t) => t.type === "page").map((t) => t.url) : [];
  check("the link opens in a tab", tabs.some((u) => u.startsWith("https://example.com/")), tabs.join(", "));
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
