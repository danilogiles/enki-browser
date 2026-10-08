// End-to-end test of the updater with a throwaway signing key: installs version A, serves
// version B from a local feed, and checks every refusal and the real update.
//
//   ENKI_DIST=extension/dist node test/update.mjs         (ENKI_DIST optional; saves two Enki builds)
import { execFileSync, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// realpath gives the long form: CI's temp folder is handed out as C:\Users\RUNNER~1\..., which
// matches nothing a process list reports.
const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "enki-update-test-")));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

// ---- keys: the one compiled into the test builds, and an impostor
const pair = () => generateKeyPairSync("rsa", { modulusLength: 3072 });
const good = pair(), evil = pair();
const goodPub = path.join(tmp, "test.pub");
writeFileSync(goodPub, good.publicKey.export({ type: "spki", format: "pem" }));

// ---- two builds
const build = (version) => {
  console.log(`\n… building ${version}`);
  execFileSync(process.execPath, [path.join(root, "build", "build.mjs")], {
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, ENKI_VERSION: version, UPDATE_PUBLIC_KEY_FILE: goodPub },
  });
};
build("0.0.1");
const install = path.join(tmp, "install");
cpSync(path.join(root, "out", "EnkiBrowser"), install, { recursive: true });
writeFileSync(path.join(install, "portable"), ""); // profile inside the install: proves it survives
// A second, untouched 0.0.1 for the update that arrives while the browser is open.
const live = path.join(tmp, "live");
cpSync(install, live, { recursive: true });
// An old version that should be cleaned up: older than both the running and the new one.
mkdirSync(path.join(install, "app", "0.0.0"), { recursive: true });
writeFileSync(path.join(install, "app", "0.0.0", "EnkiBrowserLauncher.exe"), "");
build("0.0.2");
const feedDir = path.join(tmp, "feed");
mkdirSync(feedDir);
const zipName = "EnkiBrowser-0.0.2-windows-x64.zip";
cpSync(path.join(root, "out", zipName), path.join(feedDir, zipName));
const zipSha = sha(path.join(feedDir, zipName));
// A page to visit, so the update test has real history, cookies and site storage to carry over.
writeFileSync(path.join(feedDir, "page.html"), "<!doctype html><title>Enki test page</title><h1>Enki test page</h1>");

// ---- local feed: /<name>.json and /<name>.json.sig
const server = http.createServer((req, res) => {
  const file = path.join(feedDir, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const manifest = (name, fields, key) => {
  const body = Buffer.from(JSON.stringify({ version: "0.0.2", url: `${base}/${zipName}`, sha256: zipSha, ...fields }));
  writeFileSync(path.join(feedDir, `${name}.json`), body);
  writeFileSync(path.join(feedDir, `${name}.json.sig`), sign("sha256", body, key).toString("base64"));
  return `${base}/${name}.json`;
};

const stub = path.join(install, "EnkiBrowser.exe");
const run = (args, env = {}) => new Promise((resolve) => {
  const p = spawn(stub, args, { env: { ...process.env, ...env }, stdio: "ignore" });
  p.on("exit", resolve);
});
const current = () => readFileSync(path.join(install, "current"), "utf8").trim();
const has = (v) => existsSync(path.join(install, "app", v, "EnkiBrowserLauncher.exe"));
const log = () => (existsSync(path.join(install, ".update", "update.log")) ? readFileSync(path.join(install, ".update", "update.log"), "utf8") : "");
const lastLog = () => log().trim().split("\n").at(-1)?.slice(21) ?? "";
const ourProcesses = () => {
  const out = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "name='chrome.exe' or name='EnkiBrowserLauncher.exe'" | Where-Object { $_.ExecutablePath -like '${install}\\*' } | ForEach-Object { $_.ExecutablePath }`]).toString();
  return out.split(/\r?\n/).filter(Boolean);
};
const chromes = () => ourProcesses().filter((p) => p.endsWith("chrome.exe"));
// The stub hands --enki-update-check to the current launcher and exits at once; wait for that
// launcher to finish its check.
// Only the launcher doing the check: a running browser's own launcher stays alive beside it.
const checkRunning = () => execFileSync("powershell.exe", ["-NoProfile", "-Command",
  `@(Get-CimInstance Win32_Process -Filter "name='EnkiBrowserLauncher.exe'" | Where-Object { $_.ExecutablePath -like '${install}\\*' -and $_.CommandLine -like '*--enki-update-check*' }).Count`]).toString().trim() !== "0";
const updateOnce = async (feed) => {
  await run(["--enki-update-check"], { ENKI_BROWSER_UPDATE_FEED: feed });
  for (let i = 0; i < 240 && checkRunning(); i++) await sleep(500);
};

let browser;
const connect = async (port) => {
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
    if (b) return b;
  }
  throw new Error("browser did not start");
};
const closeBrowser = async (b) => {
  const cdp = await b.newBrowserCDPSession();
  await cdp.send("Browser.close").catch(() => undefined);
  await b.close().catch(() => undefined);
  for (let i = 0; i < 60 && chromes().length; i++) await sleep(500);
  await sleep(1000);
};

// The test install registers itself as the "Check for updates" host for this Windows user; put
// back whatever was registered before (a real Enki Browser on a developer's machine).
const hostKey = "HKCU\\Software\\Chromium\\NativeMessagingHosts\\io.github.danilogiles.enki_browser";
const hostBefore = (() => { try { return /REG_SZ\s+(.+)$/m.exec(execFileSync("reg", ["query", hostKey, "/ve"], { stdio: ["ignore", "pipe", "ignore"] }).toString())?.[1].trim() ?? null; } catch { return null; } })();
const restoreHost = () => {
  try {
    if (hostBefore) execFileSync("reg", ["add", hostKey, "/ve", "/d", hostBefore, "/f"], { stdio: "ignore" });
    else execFileSync("reg", ["delete", hostKey, "/f"], { stdio: "ignore" });
  } catch { /* nothing registered either way */ }
};

// Fake Apps entry for this throwaway install: SyncRegistration rewrites DisplayVersion and
// Publisher when InstallLocation matches; portable installs never create an entry of their own.
// Save and put back whatever was registered so a real Enki Browser on a developer's machine is left alone.
const arpKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EnkiBrowser";
const arpBackup = path.join(tmp, "arp-before.reg");
const arpExisted = (() => { try { execFileSync("reg", ["export", arpKey, arpBackup, "/y"], { stdio: "ignore" }); return true; } catch { return false; } })();
const arpValue = (name) => {
  try { return /REG_SZ\s+(.+)$/m.exec(execFileSync("reg", ["query", arpKey, "/v", name], { stdio: ["ignore", "pipe", "ignore"] }).toString())?.[1].trim() ?? ""; }
  catch { return ""; }
};
const plantArp = (root, version) => {
  execFileSync("reg", ["add", arpKey, "/v", "DisplayName", "/d", "Enki Browser", "/f"], { stdio: "ignore" });
  execFileSync("reg", ["add", arpKey, "/v", "DisplayVersion", "/d", version, "/f"], { stdio: "ignore" });
  // Old publisher on purpose: SyncRegistration must rewrite it to match the certificate.
  execFileSync("reg", ["add", arpKey, "/v", "Publisher", "/d", "Enki contributors", "/f"], { stdio: "ignore" });
  execFileSync("reg", ["add", arpKey, "/v", "InstallLocation", "/d", root, "/f"], { stdio: "ignore" });
};
const restoreArp = () => {
  try {
    if (arpExisted) execFileSync("reg", ["import", arpBackup], { stdio: "ignore" });
    else execFileSync("reg", ["delete", arpKey, "/f"], { stdio: "ignore" });
  } catch { /* nothing registered either way */ }
};

try {
  check("installed version is 0.0.1", current() === "0.0.1" && has("0.0.1"), current());

  await updateOnce(manifest("forged", {}, evil.privateKey));
  check("a manifest signed with another key is refused", !has("0.0.2") && current() === "0.0.1" && /signature is invalid/.test(lastLog()), lastLog());

  await updateOnce(manifest("tampered", { sha256: "0".repeat(64) }, good.privateKey));
  check("a zip whose hash differs from the signed one is discarded", !has("0.0.2") && /does not match the signed manifest/.test(lastLog()), lastLog());

  await updateOnce(manifest("old", { version: "0.0.1" }, good.privateKey));
  check("the same or an older version is not installed", !has("0.0.2") && /up to date/.test(lastLog()), lastLog());

  // Start the browser, then update while it runs, from "Check for updates" in Shields' settings:
  // the page asks this browser's launcher (native messaging), which checks the feed now. Its own
  // background check stays quiet: the checks above were minutes ago, within its interval.
  const genuine = manifest("genuine", {}, good.privateKey);
  // Plant an Apps entry pointing at this portable copy so SyncRegistration has something to update.
  plantArp(install, "0.0.1");
  run(["--remote-debugging-port=9451", "about:blank"], { ENKI_BROWSER_UPDATE_FEED: genuine });
  browser = await connect(9451);
  writeFileSync(path.join(install, "User Data", "enki-test-marker"), "keep me"); // exists once the browser has run
  const launcher1 = path.join(install, "app", "0.0.1", "EnkiBrowserLauncher.exe");
  const before = { hash: sha(launcher1), mtime: statSync(launcher1).mtimeMs, stub: sha(stub) };
  const shieldId = JSON.parse(readFileSync(path.join(install, "app", "0.0.1", "version.json"), "utf8")).shieldExtensionId;
  const settings = await browser.contexts()[0].newPage();
  await settings.goto(`chrome-extension://${shieldId}/options.html`);
  await settings.waitForFunction(() => document.documentElement.dataset.updates === "ready", null, { timeout: 15000 });
  const shownBefore = await settings.textContent("#version");
  await settings.click("#check-updates");
  const offered = await settings.waitForFunction(() => !document.getElementById("restart-update").hidden, null, { timeout: 180000 }).then(() => true, () => false);
  check("Shields' settings show the running version", /Enki Browser 0\.0\.1/.test(shownBefore ?? ""), shownBefore ?? "");
  check("Check for updates downloads and verifies the release, and offers a restart", offered, (await settings.textContent("#update-state"))?.trim());
  check("a genuine release installs beside the running one", has("0.0.2") && current() === "0.0.2", lastLog());
  check("the running browser keeps its own version's files", chromes().length > 0 && chromes().every((p) => p.includes("\\app\\0.0.1\\")), `${chromes().length} processes in app\\0.0.1`);
  check("nothing existing was renamed, moved or rewritten", sha(launcher1) === before.hash && statSync(launcher1).mtimeMs === before.mtime && sha(stub) === before.stub);

  await closeBrowser(browser);
  browser = undefined;
  run(["--remote-debugging-port=9452", "about:blank"], { ENKI_BROWSER_NO_UPDATE: "1" });
  browser = await connect(9452);
  const product = (await (await browser.newBrowserCDPSession()).send("Browser.getVersion")).product;
  check("the next start opens 0.0.2", chromes().length > 0 && chromes().every((p) => p.includes("\\app\\0.0.2\\")), product);
  check("Settings → Apps shows the version that now runs", arpValue("DisplayVersion") === "0.0.2", arpValue("DisplayVersion"));
  check("Settings → Apps shows the publisher that matches the certificate", arpValue("Publisher") === "Danilo De Souza", arpValue("Publisher"));
  check("the profile survives the update", existsSync(path.join(install, "User Data", "enki-test-marker")));
  check("the previous version is kept for rollback", has("0.0.1"));
  check("versions older than that are removed", !existsSync(path.join(install, "app", "0.0.0")));

  // While the browser is open: the launcher that started it finds the release, installs it and
  // offers a restart; the restart reopens every tab in the new version.
  const liveLog = () => (existsSync(path.join(live, ".update", "update.log")) ? readFileSync(path.join(live, ".update", "update.log"), "utf8") : "");
  const liveChromes = () => execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.ExecutablePath -like '${live}\\*' } | ForEach-Object { $_.ExecutablePath }`]).toString().split(/\r?\n/).filter(Boolean);
  const liveLast = () => liveLog().trim().split("\n").at(-1) ?? "";
  const inNew = () => { const c = liveChromes(); return c.length > 0 && c.every((p) => p.includes("\\app\\0.0.2\\")); };
  const liveStub = path.join(live, "EnkiBrowser.exe");
  // A pin made from an open window points at chrome.exe itself, and a profile added from the
  // profile menu starts without Enki Browser's defaults: the launcher fixes both before starting.
  const shortcuts = path.join(tmp, "shortcuts");
  mkdirSync(shortcuts, { recursive: true });
  const pin = path.join(shortcuts, "Enki Browser.lnk");
  const chromeExe = path.join(live, "app", "0.0.1", "chromium", "chrome.exe");
  execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$l = (New-Object -ComObject WScript.Shell).CreateShortcut('${pin}'); $l.TargetPath = '${chromeExe}'; $l.Arguments = '--profile-directory="Profile 1"'; $l.Save()`]);
  mkdirSync(path.join(live, "User Data", "Profile 1"), { recursive: true });
  writeFileSync(path.join(live, "User Data", "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Main" }, "Profile 1": { name: "Second" } } } }));
  writeFileSync(path.join(live, "User Data", "Profile 1", "Preferences"), JSON.stringify({ profile: { name: "Second" }, extensions: { pinned_extensions: ["someotherextensionidxxxxxxxxxxxx"] } }));
  spawn(liveStub, ["--remote-debugging-port=9453", `${base}/tab-a`], { env: { ...process.env, ENKI_BROWSER_UPDATE_FEED: genuine, ENKI_BROWSER_UPDATE_NOW: "1", ENKI_BROWSER_SHORTCUT_DIRS: shortcuts }, stdio: "ignore" });
  let liveBrowser = await connect(9453);
  const repaired = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$l = (New-Object -ComObject WScript.Shell).CreateShortcut('${pin}'); $l.TargetPath + '|' + $l.Arguments`]).toString().trim();
  check("a shortcut opening chrome.exe directly is pointed back at EnkiBrowser.exe, profile kept",
    repaired.toLowerCase() === `${liveStub}|--profile-directory="Profile 1"`.toLowerCase(), repaired);
  const profile2 = JSON.parse(readFileSync(path.join(live, "User Data", "Profile 1", "Preferences"), "utf8"));
  const liveIds = JSON.parse(readFileSync(path.join(live, "app", "0.0.1", "version.json"), "utf8"));
  check("a profile added later gets Enki and Shields pinned and the grey theme, keeping its own pins",
    [liveIds.enkiExtensionId, liveIds.shieldExtensionId, "someotherextensionidxxxxxxxxxxxx"].every((id) => profile2.extensions.pinned_extensions.includes(id)) && profile2.browser?.theme?.is_grayscale2 === true,
    JSON.stringify(profile2.extensions.pinned_extensions));
  const second = await liveBrowser.contexts()[0].newPage();
  await second.goto(`${base}/tab-b`).catch(() => undefined);
  for (let i = 0; i < 240 && !/0\.0\.2 is ready/.test(liveLog()); i++) await sleep(500);
  check("an update found while the browser is open is installed and offered", /0\.0\.2 is ready; offering to restart/.test(liveLog()) && readFileSync(path.join(live, "current"), "utf8").trim() === "0.0.2", liveLast());
  // ---- the user's data before the update: an update changes the program, never this
  const userCtx = liveBrowser.contexts()[0];
  const visited = await userCtx.newPage();
  await visited.goto(`${base}/page.html?visited-before-update`);
  await visited.evaluate(() => { document.cookie = "enki_keep=1; max-age=86400; path=/"; localStorage.setItem("enki-keep", "kept"); });
  const enkiPanel = await userCtx.newPage();
  await enkiPanel.goto(`chrome-extension://${liveIds.enkiExtensionId}/src/sidepanel/index.html`);
  await enkiPanel.evaluate(() => chrome.storage.local.set({
    "enki:settings": { preset: "custom", apiKey: "sk-keep-00000000000000001234", baseUrl: "http://127.0.0.1:9/v1", model: "kept-model", saveConversations: true, acceptedTerms: "1" },
    "enki:chats": [{ id: "kept", title: "a chat from before the update", updatedAt: Date.now() }],
  }));
  await enkiPanel.reload(); await enkiPanel.waitForTimeout(1500); // the panel encrypts the key as it loads
  const shieldPage = await userCtx.newPage();
  await shieldPage.goto(`chrome-extension://${liveIds.shieldExtensionId}/options.html`);
  await shieldPage.evaluate(() => chrome.storage.local.set({ "shields:sites": { "127.0.0.1": { scripts: "block" } } }));
  await visited.close(); await enkiPanel.close(); await shieldPage.close();
  await liveBrowser.close().catch(() => undefined); // drop the CDP connection only; the browser stays
  spawn(liveStub, ["--enki-restart-to-update"], { stdio: "ignore" });
  for (let i = 0; i < 120 && !inNew(); i++) await sleep(500);
  check("restart to update reopens the browser in the new version", inNew(), liveLast());
  liveBrowser = await connect(9453);
  await sleep(2000);
  const tabs = (await (await liveBrowser.newBrowserCDPSession()).send("Target.getTargets")).targetInfos.filter((t) => t.type === "page").map((t) => t.url);
  if (!tabs.some((u) => u.endsWith("/tab-a"))) {
    const all = (await (await liveBrowser.newBrowserCDPSession()).send("Target.getTargets")).targetInfos.map((t) => t.type + " " + t.url);
    const state = existsSync(path.join(live, "User Data", "Local State")) ? JSON.parse(readFileSync(path.join(live, "User Data", "Local State"), "utf8")).profile : null;
    console.log("DEBUG targets:", JSON.stringify(all));
    console.log("DEBUG profile state:", JSON.stringify({ last_used: state?.last_used, last_active_profiles: state?.last_active_profiles }));
    console.log("DEBUG log tail:", liveLog().trim().split(/\r?\n/).slice(-6).join(" || "));
    console.log("DEBUG chrome cmd:", execFileSync("powershell.exe", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | ? { $_.ExecutablePath -like '${live}\\*' -and $_.CommandLine -notlike '*--type=*' } | % { $_.CommandLine }`]).toString().trim().slice(0, 600));
  }
  check("every tab comes back after the restart", tabs.some((u) => u.endsWith("/tab-a")) && tabs.some((u) => u.endsWith("/tab-b")), tabs.join(", "));

  // ---- the same data after the update, in the same profile
  const kept = liveBrowser.contexts()[0];
  const siteAfter = await kept.newPage();
  await siteAfter.goto(`${base}/page.html?after-update`);
  const siteData = await siteAfter.evaluate(() => ({ cookie: document.cookie, storage: localStorage.getItem("enki-keep") }));
  check("cookies and site storage survive the update", /enki_keep=1/.test(siteData.cookie) && siteData.storage === "kept", JSON.stringify(siteData));
  await siteAfter.goto("chrome://history/"); await siteAfter.waitForTimeout(1500);
  const historyText = await siteAfter.evaluate(() => { const walk = (n) => (n.shadowRoot ? walk(n.shadowRoot) : "") + [...n.childNodes].map((c) => (c.nodeType === 3 ? c.textContent : c.nodeType === 1 ? walk(c) : "")).join(" "); return walk(document.body); });
  check("browsing history survives the update", /Enki test page/.test(historyText));
  const newIds = JSON.parse(readFileSync(path.join(live, "app", "0.0.2", "version.json"), "utf8"));
  await siteAfter.goto(`chrome-extension://${newIds.enkiExtensionId}/src/sidepanel/index.html`);
  await siteAfter.waitForSelector("textarea", { timeout: 10000 }).catch(() => undefined);
  const enkiAfter = await siteAfter.evaluate(async () => {
    const all = await chrome.storage.local.get(["enki:settings", "enki:chats"]);
    return { model: all["enki:settings"]?.model, encrypted: /^enc:v1:/.test(all["enki:settings"]?.apiKeys?.custom ?? ""), listSealed: typeof all["enki:chats"]?.sealed === "string" };
  });
  // The chat list is stored encrypted: read it the way the user does, in the ⋯ menu.
  await siteAfter.click("button[title='More']").catch(() => undefined);
  const menuText = await siteAfter.evaluate(() => document.body.innerText);
  await siteAfter.keyboard.press("Escape");
  await siteAfter.click("button[title='Settings']").catch(() => undefined);
  const maskedKey = await siteAfter.textContent("[aria-label='Saved API key']").catch(() => "");
  check("Enki's settings, encrypted key and chats survive the update", newIds.enkiExtensionId === liveIds.enkiExtensionId && enkiAfter.model === "kept-model" && enkiAfter.encrypted && maskedKey === "sk-keep-••••••1234" && enkiAfter.listSealed && menuText.includes("a chat from before the update"), JSON.stringify({ ...enkiAfter, maskedKey }));
  await siteAfter.goto(`chrome-extension://${newIds.shieldExtensionId}/options.html`);
  const shieldAfter = await siteAfter.evaluate(async () => (await chrome.storage.local.get("shields:sites"))["shields:sites"]);
  check("Shields' per-site settings survive the update", shieldAfter?.["127.0.0.1"]?.scripts === "block", JSON.stringify(shieldAfter));
  await siteAfter.close();
  // A version older than the way back, appearing while the browser runs (the stub's own cleanup
  // has already happened): the launcher removes it once the browser closes.
  mkdirSync(path.join(live, "app", "0.0.0"), { recursive: true });
  writeFileSync(path.join(live, "app", "0.0.0", "EnkiBrowserLauncher.exe"), "");
  await closeBrowser(liveBrowser);
  for (let i = 0; i < 80 && existsSync(path.join(live, "app", "0.0.0")); i++) await sleep(500);
  check("old versions are removed when the browser closes", !existsSync(path.join(live, "app", "0.0.0")) && existsSync(path.join(live, "app", "0.0.1")), liveLast());
  // The stub shortcuts point at (and its icon) comes from the version now in use.
  const shippedStub = path.join(live, "app", "0.0.2", "EnkiBrowser.exe");
  for (let i = 0; i < 20 && existsSync(shippedStub) && sha(liveStub) !== sha(shippedStub); i++) await sleep(500);
  check("the stub is updated once the browser closes", existsSync(shippedStub) && sha(liveStub) === sha(shippedStub), liveLast());
} catch (e) {
  console.log(`ERROR ${e.message}`);
  console.log("--- update.log\n" + log());
  results.push({ name: "no unexpected error", ok: false });
} finally {
  restoreArp();
  restoreHost();
  if (browser) await closeBrowser(browser).catch(() => undefined);
  // Whatever this run started from its temp folder goes, even after a failure: a browser left on
  // the test's debugging port answered the next run's connect and made it test the wrong browser.
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${tmp}\\*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
  } catch { /* nothing left */ }
  server.close();
  await sleep(1000);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { console.log(`(left ${tmp})`); }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
