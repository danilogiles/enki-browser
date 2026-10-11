// Address-bar search through Enki Shield's search page (shield/search.html), on a real Linux build.
//
// The shipped default search stays DuckDuckGo; this test alone writes an initial_preferences that
// points the default at Shield's page (restored afterwards). Every connection the browser makes
// goes through a local proxy that logs it and answers by itself, so the test also proves:
//   - nothing leaves while typing in the address bar (only after Enter);
//   - a plain search goes to DuckDuckGo with only q (Enki on main does not answer yet → DDG);
//   - "@ddg …" → DuckDuckGo, "@enki …" → Enki's search page;
//   - Incognito, with Shield allowed there → DuckDuckGo;
//   - Cloak's rule: a site opened in Incognito is nowhere in Shield's storage afterwards.
// Real key presses (xdotool), as the address bar ignores synthetic input.
//
//   ENKI_LINUX_DIR=… xvfb-run -a node test/search-redirect.mjs     needs xdotool
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = process.env.ENKI_LINUX_DIR ?? path.join(root, "out", "linux", "enki-browser");
const version = JSON.parse(readFileSync(path.join(app, "version.json"), "utf8"));
const SHIELD = version.shieldExtensionId;
const ENKI = version.enkiExtensionId;
const PROBE = "enki-incognito-probe.test";
const port = 9344;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
async function until(fn, ms) {
  const end = Date.now() + ms; let last;
  do { last = await fn().catch(() => undefined); if (last) return last; await sleep(250); } while (Date.now() < end);
  return last;
}

// The proxy: logs each request line; serves a page for the probe host, 502 for everything else.
const log = [];
const proxy = net.createServer((c) => {
  c.once("data", (d) => {
    const line = d.toString("latin1").split("\r\n")[0];
    log.push({ t: Date.now(), line });
    if (line.includes(PROBE) && line.startsWith("GET")) c.end("HTTP/1.1 200 OK\r\ncontent-type: text/html\r\nconnection: close\r\n\r\n<title>probe</title>probe");
    else c.end("HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
  });
  c.on("error", () => {});
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));

const prefsFile = path.join(app, "chromium", "initial_preferences");
const shipped = readFileSync(prefsFile);
const prefs = JSON.parse(shipped);
check("the shipped default search is not Shield's page", !JSON.stringify(prefs.default_search_provider_data ?? {}).includes("search.html"));
prefs.default_search_provider_data = { template_url_data: { keyword: "enki", short_name: "Enki", url: `chrome-extension://${SHIELD}/search.html?q={searchTerms}` } };
prefs.search = { suggest_enabled: false };

const userData = mkdtempSync(path.join(os.tmpdir(), "enki-search-redirect-"));
let proc;
const start = async (extra = []) => {
  proc = spawn(path.join(app, "enki-browser"), [`--remote-debugging-port=${port}`, "--no-sandbox", "--window-size=1200,800", ...extra, "about:blank"], {
    env: { ...process.env, ENKI_BROWSER_USER_DATA: userData }, stdio: "ignore",
  });
  const b = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 30000);
  if (!b) throw new Error("browser did not start");
  return b;
};
const stop = async (b) => { await b?.close().catch(() => {}); proc?.kill(); await sleep(1500); };
const xdo = (...a) => execFileSync("xdotool", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const pages = async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page");
async function omnibox(text) {
  const w = xdo("search", "--onlyvisible", "--class", "enki-browser").split("\n").pop();
  try { xdo("windowactivate", "--sync", w); } catch { xdo("windowfocus", "--sync", w); } // no window manager under xvfb
  xdo("key", "ctrl+l"); await sleep(400);
  const typing = Date.now();
  xdo("type", "--delay", "120", text); await sleep(2500);
  const enter = Date.now();
  xdo("key", "Return");
  return { typing, enter };
}
const ddgUrl = (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
const landed = (prefix) => until(async () => (await pages()).map((p) => p.url).find((u) => u.startsWith(prefix)), 8000);

let browser;
try {
  writeFileSync(prefsFile, JSON.stringify(prefs));
  // First run creates the profile; then "Allow in Incognito" is set for Shield the way a person's
  // click stores it on Linux (Preferences only; Secure Preferences is never touched).
  browser = await start(); await sleep(3000); await stop(browser);
  const pf = path.join(userData, "Default", "Preferences");
  const p = JSON.parse(readFileSync(pf, "utf8"));
  ((p.extensions ??= {}).settings ??= {})[SHIELD] = { ...(p.extensions.settings[SHIELD] ?? {}), incognito: true };
  writeFileSync(pf, JSON.stringify(p));

  browser = await start([`--proxy-server=http://127.0.0.1:${proxy.address().port}`, "--proxy-bypass-list=<-loopback>"]);
  await sleep(4000);
  const ctx = browser.contexts()[0];
  const sw = await until(async () => ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${SHIELD}/`)), 15000);
  check("Shield is allowed in Incognito (test profile)", await sw.evaluate(() => chrome.extension.isAllowedIncognitoAccess()));
  const enkiManifest = JSON.parse(readFileSync(path.join(app, "extensions", "enki", "manifest.json"), "utf8"));
  const enkiReady = JSON.stringify(enkiManifest.web_accessible_resources ?? []).includes("search.html");

  // shield:incognitoAllowed: Enki only, that exact message, exactly two booleans back.
  const workerOf = (id) => ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`));
  const ask = (w, msg) => w.evaluate(([id, m]) => chrome.runtime.sendMessage(id, m).then((r) => r ?? "no answer", (e) => "error: " + e.message), [SHIELD, msg]);
  async function checkAllowedReply(setupDone) {
    const enkiSw = await until(async () => workerOf(ENKI), 10000);
    const r = await ask(enkiSw, { type: "shield:incognitoAllowed" });
    check(`Enki gets {allowed, searchSetupDone} (searchSetupDone ${setupDone})`, r && typeof r === "object" && JSON.stringify(Object.keys(r).sort()) === '["allowed","searchSetupDone"]' && r.allowed === true && r.searchSetupDone === setupDone, JSON.stringify(r));
    const extra = await ask(enkiSw, { type: "shield:incognitoAllowed", host: "x" });
    check("…a message with any other field gets no answer", typeof extra === "string", JSON.stringify(extra));
    const other = workerOf(version.ublockExtensionId) ?? ctx.serviceWorkers().find((w) => /^chrome-extension:/.test(w.url()) && !w.url().includes(SHIELD) && !w.url().includes(ENKI));
    if (other) {
      const r2 = await ask(other, { type: "shield:incognitoAllowed" });
      check("…another extension gets no answer", typeof r2 === "string", JSON.stringify(r2));
    } else console.log("SKIP another-extension sender: no other extension worker running");
  }
  const storageDump = () => sw.evaluate(async () => JSON.stringify([await chrome.storage.local.get(null), await chrome.storage.sync.get(null), await chrome.storage.session.get(null)]));
  // Records what Shield sends Enki (a listener that never answers, so routing is unchanged).
  const enkiWorker = await until(async () => workerOf(ENKI), 10000);
  await enkiWorker.evaluate(() => {
    globalThis.__shieldMsgs = [];
    chrome.runtime.onMessageExternal.addListener((msg, sender) => { globalThis.__shieldMsgs.push({ from: sender.id, msg }); return false; });
  });
  const sent = () => enkiWorker.evaluate(() => globalThis.__shieldMsgs ?? null);
  // 1. Incognito (first, so nothing from a normal window has set the setup flag yet): always DuckDuckGo; and the probe site leaves nothing in Shield's storage.
  xdo("key", "ctrl+shift+n"); await sleep(3000);
  await omnibox("incognito query");
  check("Incognito search → DuckDuckGo", !!(await landed(ddgUrl("incognito query"))));
  await omnibox(`http://${PROBE}/page`);
  check("the probe site opened in Incognito", !!(await landed(`http://${PROBE}/`)), log.filter((l) => l.line.includes(PROBE)).map((l) => l.line).join(" | "));
  await sleep(1500);
  xdo("key", "ctrl+shift+w"); await sleep(2500);
  const stored = await storageDump();
  check("the Incognito site is not in Shield's storage", !stored.includes(PROBE));
  check("an Incognito search does not set searchSetupDone", !stored.includes("searchSetupDone"));
  const incogMsgs = (await sent()) ?? [];
  check("an Incognito search sends Enki nothing (no incognitoAllowed)", !JSON.stringify(incogMsgs).includes("incognitoAllowed") && incogMsgs.filter((x) => x.from === SHIELD).length === 0, JSON.stringify(incogMsgs));
  await checkAllowedReply(false);
  // 2. Typing sends nothing; Enter goes to DuckDuckGo (Enki does not answer on this build, or says ddg).
  log.length = 0;
  const q1 = "zebraquokka7731 tallest mountain";
  const t1 = await omnibox(q1);
  const during = log.filter((l) => l.t >= t1.typing && l.t < t1.enter);
  check("no connection while typing", during.length === 0, during.map((l) => l.line).join(" | "));
  check("a plain search lands on DuckDuckGo with only q", !!(await landed(ddgUrl(q1))), (await pages()).map((x) => x.url).join(", "));
  const ddgReq = log.find((l) => l.line.includes("duckduckgo.com"));
  check("…and the first connection after Enter is DuckDuckGo", !!ddgReq && log.indexOf(ddgReq) === 0, log.map((l) => l.line).join(" | "));

  const msgs = ((await sent()) ?? []).filter((x) => x.from === SHIELD && x.msg?.type === "enki:getSearchEngine");
  check("Shield asked Enki with {type, incognitoAllowed} only", msgs.length >= 1 && msgs.every((x) => JSON.stringify(Object.keys(x.msg).sort()) === '["incognitoAllowed","type"]' && x.msg.incognitoAllowed === true), JSON.stringify(msgs));
  check("…and the message never contains the search words", !JSON.stringify(msgs).includes("zebraquokka7731") && !JSON.stringify(msgs).includes("tallest"));
  await sleep(500);
  const after = JSON.parse(await storageDump());
  check("the search words are nowhere in Shield's storage (local/sync/session)", !JSON.stringify(after).includes("zebraquokka7731"));
  check("…only searchSetupDone and its date were recorded", after[0].searchSetupDone === true && /^\d{4}-\d{2}-\d{2}$/.test(after[0].searchSetupDoneAt ?? ""), JSON.stringify({ d: after[0].searchSetupDone, at: after[0].searchSetupDoneAt }));
  await checkAllowedReply(true);
  // 3. Per-search prefixes.
  await omnibox("@ddg rust traits");
  check("@ddg → DuckDuckGo without the prefix", !!(await landed(ddgUrl("rust traits"))));
  await omnibox("@enki why is the sky blue");
  const enkiTarget = `chrome-extension://${ENKI}/search.html?q=${encodeURIComponent("why is the sky blue")}`;
  if (enkiReady) check("@enki → Enki's answer page", !!(await landed(enkiTarget)));
  else {
    const got = await landed(enkiTarget);
    console.log(`SKIP @enki rendering: Enki on this build has no search.html in web_accessible_resources (Spark's PR); redirect target ${got ? "seen" : "not seen"}`);
  }

  // 4. Shields' settings: the selector shows what the address bar really does.
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${SHIELD}/options.html`);
  await until(() => opt.evaluate(() => document.documentElement.dataset.search === "ready"), 10000);
  const sel = await opt.evaluate(() => ({
    checked: document.querySelector('#search-seg [aria-checked="true"]')?.dataset.engine,
    disabled: document.getElementById("search-seg").classList.contains("dis"),
    state: document.getElementById("search-state").hidden ? "" : document.getElementById("search-state").textContent,
  }));
  if (enkiReady) check("settings: DuckDuckGo selected (Enki AI not chosen)", sel.checked === "ddg", JSON.stringify(sel));
  else check("settings: Enki does not answer → disabled on DuckDuckGo, 'Turn on Enki to use AI search'", sel.checked === "ddg" && sel.disabled && /Turn on Enki/.test(sel.state), JSON.stringify(sel));
  await opt.close();

  await stop(browser); browser = null;
  const extDirs = ["Local Extension Settings", "Extension State", "Sync Extension Settings"].map((d) => path.join(userData, "Default", d, SHIELD));
  const files = extDirs.filter(existsSync).flatMap((d) => readdirSync(d).map((f) => path.join(d, f))).filter((f) => statSync(f).isFile());
  const hit = files.filter((f) => readFileSync(f).includes(PROBE) || readFileSync(f).includes("zebraquokka7731"));
  check("the probe site and the search words are not in its storage files on disk", hit.length === 0, hit.join(", "));
} catch (e) {
  check("search redirect", false, e.stack ?? String(e));
} finally {
  await stop(browser);
  writeFileSync(prefsFile, shipped);
  proxy.close();
  rmSync(userData, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
