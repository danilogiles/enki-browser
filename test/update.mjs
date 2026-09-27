// End-to-end test of the updater with a throwaway signing key: installs version A, serves
// version B from a local feed, and checks every refusal and the real update.
//
//   ENKI_DIST=../enkibrowser/dist node test/update.mjs      (ENKI_DIST optional; saves two clones)
import { execFileSync, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "enki-update-test-"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
build("0.0.2");
const feedDir = path.join(tmp, "feed");
mkdirSync(feedDir);
const zipName = "EnkiBrowser-0.0.2-windows-x64.zip";
cpSync(path.join(root, "out", zipName), path.join(feedDir, zipName));
const zipSha = createHash("sha256").update(readFileSync(path.join(feedDir, zipName))).digest("hex");

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

const launcher = path.join(install, "EnkiBrowser.exe");
const run = (args, env = {}) => new Promise((resolve) => {
  const p = spawn(launcher, args, { env: { ...process.env, ...env }, stdio: "ignore" });
  p.on("exit", resolve);
});
const ready = () => existsSync(path.join(install, ".update", "ready.json"));
const version = () => JSON.parse(readFileSync(path.join(install, "version.json"), "utf8")).enkiBrowser;
const log = () => (existsSync(path.join(install, ".update", "update.log")) ? readFileSync(path.join(install, ".update", "update.log"), "utf8") : "");
const lastLog = () => log().trim().split("\n").at(-1)?.slice(21) ?? "";
const updateOnce = (feed) => run(["--enki-update-check"], { ENKI_BROWSER_UPDATE_FEED: feed });

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
  for (let i = 0; i < 40; i++) {
    const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq chrome.exe", "/FO", "CSV", "/NH"]).toString();
    if (!out.includes("chrome.exe")) break;
    await sleep(250);
  }
  await sleep(1000);
};

try {
  check("installed version is 0.0.1", version() === "0.0.1", version());

  await updateOnce(manifest("forged", {}, evil.privateKey));
  check("a manifest signed with another key is refused", !ready() && /signature is invalid/.test(lastLog()), lastLog());

  await updateOnce(manifest("tampered", { sha256: "0".repeat(64) }, good.privateKey));
  check("a zip whose hash differs from the signed one is discarded", !ready() && /does not match the signed manifest/.test(lastLog()), lastLog());

  await updateOnce(manifest("old", { version: "0.0.1" }, good.privateKey));
  check("the same or an older version is not installed", !ready() && /up to date/.test(lastLog()), lastLog());

  // Start the browser, then stage a real update while it runs.
  const genuine = manifest("genuine", {}, good.privateKey);
  run(["--remote-debugging-port=9451", "about:blank"], { ENKI_BROWSER_NO_UPDATE: "1" });
  browser = await connect(9451);
  writeFileSync(path.join(install, "User Data", "enki-test-marker"), "keep me"); // the profile exists once the browser has run
  await updateOnce(genuine);
  check("a genuine newer release is downloaded, verified and staged", ready() && /staged 0\.0\.2/.test(lastLog()), lastLog());

  await run(["about:blank"], { ENKI_BROWSER_UPDATE_FEED: genuine });
  check("nothing is replaced while the browser is open", version() === "0.0.1" && ready() && /waiting for the browser to close/.test(log()), `still ${version()}`);

  await closeBrowser(browser);
  browser = undefined;
  await run(["--remote-debugging-port=9452", "about:blank"], { ENKI_BROWSER_UPDATE_FEED: genuine });
  browser = await connect(9452);
  const product = (await (await browser.newBrowserCDPSession()).send("Browser.getVersion")).product;
  check("after closing, the next launch installs 0.0.2 and the browser starts", version() === "0.0.2" && !ready(), `${version()} · ${product}`);
  check("the profile survives the update", existsSync(path.join(install, "User Data", "enki-test-marker")));
  check("the previous version is kept for rollback", existsSync(path.join(install, ".previous", "version.json"))
    && JSON.parse(readFileSync(path.join(install, ".previous", "version.json"), "utf8")).enkiBrowser === "0.0.1");
} finally {
  if (browser) await closeBrowser(browser).catch(() => undefined);
  server.close();
  await sleep(1000);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { console.log(`(left ${tmp})`); }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
