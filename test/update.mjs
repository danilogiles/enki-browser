// End-to-end test of the updater with a throwaway signing key: installs version A, serves
// version B from a local feed, and checks every refusal and the real update.
//
//   ENKI_DIST=../enkibrowser/dist node test/update.mjs      (ENKI_DIST optional; saves two clones)
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
const updateOnce = async (feed) => {
  await run(["--enki-update-check"], { ENKI_BROWSER_UPDATE_FEED: feed });
  for (let i = 0; i < 240 && ourProcesses().some((p) => p.endsWith("EnkiBrowserLauncher.exe")); i++) await sleep(500);
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

try {
  check("installed version is 0.0.1", current() === "0.0.1" && has("0.0.1"), current());

  await updateOnce(manifest("forged", {}, evil.privateKey));
  check("a manifest signed with another key is refused", !has("0.0.2") && current() === "0.0.1" && /signature is invalid/.test(lastLog()), lastLog());

  await updateOnce(manifest("tampered", { sha256: "0".repeat(64) }, good.privateKey));
  check("a zip whose hash differs from the signed one is discarded", !has("0.0.2") && /does not match the signed manifest/.test(lastLog()), lastLog());

  await updateOnce(manifest("old", { version: "0.0.1" }, good.privateKey));
  check("the same or an older version is not installed", !has("0.0.2") && /up to date/.test(lastLog()), lastLog());

  // Start the browser, then update while it runs.
  const genuine = manifest("genuine", {}, good.privateKey);
  run(["--remote-debugging-port=9451", "about:blank"], { ENKI_BROWSER_NO_UPDATE: "1" });
  browser = await connect(9451);
  writeFileSync(path.join(install, "User Data", "enki-test-marker"), "keep me"); // exists once the browser has run
  const launcher1 = path.join(install, "app", "0.0.1", "EnkiBrowserLauncher.exe");
  const before = { hash: sha(launcher1), mtime: statSync(launcher1).mtimeMs, stub: sha(stub) };
  await updateOnce(genuine);
  check("a genuine release installs beside the running one", has("0.0.2") && current() === "0.0.2", lastLog());
  check("the running browser keeps its own version's files", chromes().length > 0 && chromes().every((p) => p.includes("\\app\\0.0.1\\")), `${chromes().length} processes in app\\0.0.1`);
  check("nothing existing was renamed, moved or rewritten", sha(launcher1) === before.hash && statSync(launcher1).mtimeMs === before.mtime && sha(stub) === before.stub);

  await closeBrowser(browser);
  browser = undefined;
  run(["--remote-debugging-port=9452", "about:blank"], { ENKI_BROWSER_NO_UPDATE: "1" });
  browser = await connect(9452);
  const product = (await (await browser.newBrowserCDPSession()).send("Browser.getVersion")).product;
  check("the next start opens 0.0.2", chromes().length > 0 && chromes().every((p) => p.includes("\\app\\0.0.2\\")), product);
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
  spawn(liveStub, ["--remote-debugging-port=9453", `${base}/tab-a`], { env: { ...process.env, ENKI_BROWSER_UPDATE_FEED: genuine, ENKI_BROWSER_UPDATE_NOW: "1" }, stdio: "ignore" });
  let liveBrowser = await connect(9453);
  const second = await liveBrowser.contexts()[0].newPage();
  await second.goto(`${base}/tab-b`).catch(() => undefined);
  for (let i = 0; i < 240 && !/0\.0\.2 is ready/.test(liveLog()); i++) await sleep(500);
  check("an update found while the browser is open is installed and offered", /0\.0\.2 is ready; offering to restart/.test(liveLog()) && readFileSync(path.join(live, "current"), "utf8").trim() === "0.0.2", liveLast());
  await liveBrowser.close().catch(() => undefined); // drop the CDP connection only; the browser stays
  spawn(liveStub, ["--enki-restart-to-update"], { stdio: "ignore" });
  for (let i = 0; i < 120 && !inNew(); i++) await sleep(500);
  check("restart to update reopens the browser in the new version", inNew(), liveLast());
  liveBrowser = await connect(9453);
  await sleep(2000);
  const tabs = (await (await liveBrowser.newBrowserCDPSession()).send("Target.getTargets")).targetInfos.filter((t) => t.type === "page").map((t) => t.url);
  check("every tab comes back after the restart", tabs.some((u) => u.endsWith("/tab-a")) && tabs.some((u) => u.endsWith("/tab-b")), tabs.join(", "));
  // A version older than the way back, appearing while the browser runs (the stub's own cleanup
  // has already happened): the launcher removes it once the browser closes.
  mkdirSync(path.join(live, "app", "0.0.0"), { recursive: true });
  writeFileSync(path.join(live, "app", "0.0.0", "EnkiBrowserLauncher.exe"), "");
  await closeBrowser(liveBrowser);
  for (let i = 0; i < 80 && existsSync(path.join(live, "app", "0.0.0")); i++) await sleep(500);
  check("old versions are removed when the browser closes", !existsSync(path.join(live, "app", "0.0.0")) && existsSync(path.join(live, "app", "0.0.1")), liveLast());
} catch (e) {
  console.log(`ERROR ${e.message}`);
  console.log("--- update.log\n" + log());
  results.push({ name: "no unexpected error", ok: false });
} finally {
  if (browser) await closeBrowser(browser).catch(() => undefined);
  server.close();
  await sleep(1000);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { console.log(`(left ${tmp})`); }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
