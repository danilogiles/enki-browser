// The address bar never turns a typed search into a website address (0.8.9).
//
// Types a multi-word search into the real address bar (xdotool, under Xvfb) of a built Linux Enki
// Browser and checks where it lands and that no DNS lookup of the typed words happened (net log),
// for each kind of profile people have:
//   new        DuckDuckGo default (0.8.8+ initial_preferences)
//   legacy     Enki's panel as the engine (profiles from 0.7.2–0.8.7), Enki loaded
//   no-enki    the same profile, Enki missing (its extension folder removed)
//   no-engine  a profile without any default engine (what a reset of Chromium's protected setting
//              leaves in ungoogled-chromium, which has no built-in engines)
//   incognito  no-engine, typed in an Incognito window, Shield allowed in Incognito
//   incognito-no-shield  the same with Shield not allowed there: a known limit (Shield's rule cannot
//              run, so the words may still be looked up as a site name). Recorded, never a failure.
//
// Windows and macOS: only the rule checks run (no xdotool to type into the real address bar there);
// the address-bar cases print SKIP and exit 0.
//
//   xvfb-run -a node test/omnibox.mjs        build in out/linux/enki-browser (or ENKI_LINUX_DIR)
//   CI=1 ...                                 this test's browser runs with --no-sandbox (set by CI
//                                            runners; set it by hand in containers without user namespaces)
//   ENKI_OMNIBOX_APP=<dir>                   where each case's copy of the build goes (default
//                                            $TMPDIR/enki-omnibox-app)
//
// Also runs test/network-hosts.mjs (0.8.11): its PRIVACY.md list checks with the rule checks, on
// every OS, and its browser part after the address-bar cases, on the build itself. Here because
// this is the Linux job's test that already drives the real address bar and reads the net log.
import { execSync, spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { checkAllowlist, checkHostParser, checkNetLogJudge, judgeTypedWordsLookup, readNetLog, runNetworkHosts, stopBrowser } from "./network-hosts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = process.env.ENKI_LINUX_DIR ?? path.join(root, "out", "linux", "enki-browser");
// Without a build: the static rule and the helper agree, and only typed words match.
let allowed; // PRIVACY.md's allowed hosts, for the network-hosts part at the end
{
  const { TYPED_WORDS, enkiSearchFallback, enkiSearchFailed } = await import("../shield/omnibox.js");
  const rule = JSON.parse(readFileSync(path.join(root, "shield", "rules", "omnibox.json"), "utf8"))[0];
  const fromRule = new RegExp(rule.condition.regexFilter, "i");
  const words = ["http://elon%20musk%20github/", "https://a%20b", "http://two%20words/"];
  const sites = ["https://github.com/", "http://localhost:8080/", "https://duckduckgo.com/?q=a%20b", "http://example.com/a%20b", "http://user%20x@host/"];
  const ok = words.every((u) => fromRule.test(u) && TYPED_WORDS.test(u)) && sites.every((u) => !fromRule.test(u) && !TYPED_WORDS.test(u))
    && rule.condition.resourceTypes.join() === "main_frame";
  const enkiUrl = "chrome-extension://caelfocbikejgdamghjlkpmbbaobehlp/src/sidepanel/index.html?q=elon+musk";
  const fb = enkiSearchFallback(enkiUrl) === "https://duckduckgo.com/?q=elon%20musk" && enkiSearchFallback("https://x.com/?q=a") === null
    && enkiSearchFailed({ url: enkiUrl, status: "complete", title: enkiUrl }) && !enkiSearchFailed({ url: enkiUrl, status: "complete", title: "Enki" })
    && !enkiSearchFailed({ url: enkiUrl, status: "complete", title: "elon musk — Enki" });
  console.log(`${ok ? "PASS" : "FAIL"} rule: only addresses made of typed words go to DuckDuckGo`);
  console.log(`${fb ? "PASS" : "FAIL"} fallback: Enki's search page that failed to open goes to DuckDuckGo`);
  let listed = true;
  const listCheck = (n, pass, d = "") => { listed &&= pass; console.log(`${pass ? "PASS" : "FAIL"} ${n}${d ? ` — ${d}` : ""}`); };
  checkHostParser(listCheck);
  checkNetLogJudge(listCheck);
  allowed = checkAllowlist(listCheck);
  if (!ok || !fb || !listed || !allowed) process.exit(1);
  if (process.argv.includes("--unit")) process.exit(0);
}
if (process.platform !== "linux") { console.log(`SKIP omnibox address-bar cases on ${process.platform}: they need Linux with xdotool and an X display (rule checks above passed)`); process.exit(0); }
try { execSync("command -v xdotool", { stdio: "ignore", shell: "/bin/bash" }); } catch { console.log("SKIP omnibox address-bar cases: xdotool not installed"); process.exit(0); }
if (!process.env.DISPLAY) { console.log("SKIP omnibox address-bar cases: no X display (run under xvfb-run -a)"); process.exit(0); }
const version = JSON.parse(readFileSync(path.join(build, "version.json"), "utf8"));
const ENKI = `chrome-extension://${version.enkiExtensionId}/src/sidepanel/index.html?q=`;
const QUERY = "elon musk github replacemente";
const port = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// One fixed place for each case's copy of the build.
const APP = path.resolve(process.env.ENKI_OMNIBOX_APP ?? path.join(os.tmpdir(), "enki-omnibox-app"));
// The copy runs from a temp folder, which on Ubuntu 23.10+ (the CI runner) has no AppArmor profile,
// so Chromium's sandbox cannot start there and the browser exits at once. With CI set, only this test's browser runs without the sandbox; the product launcher and its
// defaults are untouched. What is checked (where the search lands, DNS, addresses) does not depend
// on the sandbox.
const NO_SANDBOX = !!process.env.CI && process.env.CI !== "false";
if (NO_SANDBOX) console.log("note: test browser runs with --no-sandbox (CI is set)");
// The launcher execs Chromium, so the child is Chromium itself, in its own process group.
// stopApp closes it cleanly (DevTools Browser.close when connected, else SIGTERM to Chromium
// alone, each with a bounded wait), so that it finishes the net log, then kills leftovers in the
// group: a SIGTERM to the whole group could stop the network service before the browser, which
// then restarts it and re-creates the net log empty (CI run 39882585602).
const launchApp = (args, userData) => spawn(path.join(APP, "enki-browser"), args, { env: { ...process.env, ENKI_BROWSER_USER_DATA: userData }, stdio: ["ignore", "ignore", "pipe"], detached: true });
const stopApp = (child, browser) => stopBrowser(child, { close: browser ? () => browser.newBrowserCDPSession().then((s) => s.send("Browser.close")) : undefined });
const alive = (c) => c.exitCode === null && c.signalCode === null;
// Polls `test` until it gives a value or `ms` runs out (then undefined): every wait below ends on a
// real signal or on this deadline, never on a fixed sleep.
async function until(test, ms, every = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await test();
    if (v) return v;
    if (Date.now() >= end) return undefined;
    await sleep(every);
  }
}
// One DevTools HTTP answer from 127.0.0.1:9334, or a rejection (nothing there, an error status,
// or no answer within 2 s).
const devtools = (p) => fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(2000) })
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
const PORT_FREE_MS = 10000;
const DEVTOOLS_MS = 30000;
/** Whether nothing listens on 127.0.0.1:9334, waiting up to 10 s for a previous browser to let go. */
async function portFree() {
  const bindable = () => new Promise((r) => {
    const srv = net.createServer().once("error", () => r(false)).once("listening", () => srv.close(() => r(true)));
    srv.listen(port, "127.0.0.1");
  });
  return !!(await until(bindable, PORT_FREE_MS));
}
/** Why the port is not free, for the failure message: who answers there, if it is a browser. */
async function portHolder() {
  const v = await devtools("/json/version").catch(() => null);
  return `something still listens on 127.0.0.1:${port} after ${PORT_FREE_MS / 1000} s${v?.Browser ? ` (DevTools of ${v.Browser}: a browser left over from an earlier run?)` : ""}; stop it and run again`;
}
/**
 * Polls DevTools' /json/version on the port until the browser answers, it exits, or 30 s pass.
 * The port was free right before the launch, so the browser that answers is this one.
 * Returns { version } or { error } with a message that says which of the three happened.
 */
async function devToolsUp(child, tail) {
  const r = await until(async () => (!alive(child) ? { exited: true } : await devtools("/json/version").then((v) => (v?.webSocketDebuggerUrl ? { version: v } : null), () => null)), DEVTOOLS_MS);
  if (r?.version) return r;
  const why = r?.exited ? `exited (${child.exitCode ?? child.signalCode}) before DevTools answered on port ${port}`
    : `no answer from http://127.0.0.1:${port}/json/version within ${DEVTOOLS_MS / 1000} s`;
  const t = tail();
  return { error: `${why}${t ? ` — ${t}` : ""}` };
}
/** Whether Shield's service worker is up (a DevTools target), i.e. Shield is loaded in this profile. */
const shieldWorkerUp = () => devtools("/json/list")
  .then((t) => t.some((x) => x.type === "service_worker" && x.url.startsWith(`chrome-extension://${version.shieldExtensionId}/`)), () => false);
const EXTENSION_MS = 20000;
const results = [];
const known = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const prefs = JSON.parse(readFileSync(path.join(build, "chromium", "initial_preferences"), "utf8"));
const legacyEngine = {
  template_url_data: {
    short_name: "Enki", keyword: "enki", url: `${ENKI}{searchTerms}`,
    favicon_url: `chrome-extension://${version.enkiExtensionId}/public/icons/icon32.png`,
    safe_for_autoreplace: false, input_encodings: ["UTF-8"],
  },
};

async function run(name, { engine, withoutEnki = false, incognito = false, shieldIncognito = false, knownLimit = false }, expect) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), `enki-omnibox-${name}-`));
  const app = APP;
  rmSync(app, { recursive: true, force: true });
  cpSync(build, app, { recursive: true });
  if (withoutEnki) rmSync(path.join(app, "extensions", "enki"), { recursive: true, force: true });
  const p = { ...prefs };
  if (engine === "none") delete p.default_search_provider_data;
  else if (engine === "legacy") p.default_search_provider_data = legacyEngine;
  // Chromium on Linux reads initial_preferences from its own folder when the profile is created.
  writeFileSync(path.join(app, "chromium", "initial_preferences"), JSON.stringify(p));
  const netlog = path.join(tmp, "netlog.json");
  const args = [`--remote-debugging-port=${port}`, `--log-net-log=${netlog}`, "about:blank"];
  if (NO_SANDBOX) args.unshift("--no-sandbox");
  const userData = path.join(tmp, "data");
  let stderr = "";
  const launch = (a) => { const c = launchApp(a, userData); c.stderr.on("data", (d) => { stderr = (stderr + d).slice(-4000); }); return c; };
  const tail = () => stderr.trim().split("\n").slice(-3).join(" | ");
  const fail = (what, detail) => { check(`${name}: ${what}`, false, detail); rmSync(tmp, { recursive: true, force: true }); };
  if (!(await portFree())) return fail(`debugging port ${port} is free`, await portHolder());
  if (incognito) {
    // First run creates the profile; then "Allow in Incognito" is set (or left off) for Shield the
    // way a person's click stores it on Linux: Preferences only, Secure Preferences untouched.
    // The first run ends once Shield's service worker is up (Shield registered in the new
    // profile), and its exit writes the profile; the second launch waits for the port to be free.
    const first = launch(args.filter((a) => !a.startsWith("--log-net-log")));
    const pf = path.join(userData, "Default", "Preferences");
    let firstUp;
    try {
      firstUp = await devToolsUp(first, tail);
      if (firstUp.version && !(await until(shieldWorkerUp, EXTENSION_MS))) firstUp = { error: `Shield's service worker did not start within ${EXTENSION_MS / 1000} s` };
    } finally { await stopApp(first); }
    if (firstUp.error) return fail("first run registered Shield", firstUp.error);
    if (!(await portFree())) return fail(`debugging port ${port} is free after the first run`, await portHolder());
    let pr = null;
    try { pr = JSON.parse(readFileSync(pf, "utf8")); } catch (e) {
      return fail("first run created the profile", `${e.message}${stderr ? ` — ${tail()}` : ""}`);
    }
    const sid = version.shieldExtensionId;
    ((pr.extensions ??= {}).settings ??= {})[sid] = { ...(pr.extensions.settings[sid] ?? {}), incognito: shieldIncognito };
    writeFileSync(pf, JSON.stringify(pr));
  }
  const child = launch(args);
  let browser;
  try {
    // Not a pass and not a crash: say why, and fail the case's checks.
    const up = await devToolsUp(child, tail);
    if (up.error) { check(`${name}: browser started`, false, up.error); return; }
    browser = await chromium.connectOverCDP(up.version.webSocketDebuggerUrl, { timeout: 10000 }).catch((e) => { check(`${name}: DevTools connection`, false, e.message.split("\n")[0]); return null; });
    if (!browser) return;
    const ctx = browser.contexts()[0];
    await new Promise((r) => setTimeout(r, 4000)); // extensions up, first-run tabs open
    const page = await ctx.newPage();
    await page.bringToFront();
    if (incognito) {
      // Before the Incognito window opens: Shield's own answer, from its service worker, polled
      // until the worker is up and reports the setting the profile was given (or 20 s pass).
      let allowed = "Shield's service worker did not start";
      const settled = await until(async () => {
        const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${version.shieldExtensionId}/`));
        if (!sw) return false;
        allowed = await sw.evaluate(() => chrome.extension.isAllowedIncognitoAccess()).catch((e) => `isAllowedIncognitoAccess failed: ${e.message.split("\n")[0]}`);
        return allowed === shieldIncognito;
      }, EXTENSION_MS);
      check(`${name}: Shield ${shieldIncognito ? "is" : "is not"} allowed in Incognito (test profile)`, !!settled, `${String(allowed)}${settled ? "" : ` after ${EXTENSION_MS / 1000} s`}`);
      if (!settled) return; // typing into Incognito now would test the wrong setting
    }
    const navs = []; // main-frame addresses that committed (a redirected request never commits)
    const watch = (pg) => pg.on("framenavigated", (f) => { if (f === pg.mainFrame()) navs.push(f.url()); });
    ctx.pages().forEach(watch); ctx.on("page", watch);
    // A navigation to the typed words that went to the network (failed there) rather than being
    // turned into a search before any lookup.
    const wentOut = [];
    ctx.on("requestfailed", (r) => { if (/^https?:\/\/[^/]*%20/.test(r.url())) wentOut.push(r.url()); });
    execSync(`xdotool search --sync --onlyvisible --class enki-browser windowactivate --sync 2>/dev/null; sleep 0.5; ${incognito ? "xdotool key ctrl+shift+n; sleep 2.5; xdotool search --sync --onlyvisible --class enki-browser | tail -1 | xargs -r xdotool windowactivate --sync 2>/dev/null; sleep 0.5; " : ""}xdotool key ctrl+l; sleep 0.5; xdotool type --delay 20 "${QUERY}"; sleep 0.8; xdotool key Return`, { shell: "/bin/bash" });
    let landed = "";
    const want = expect === "Enki" ? ENKI : "https://duckduckgo.com/?q=";
    for (let i = 0; i < 30; i++) {
      // Every page target, Incognito windows included (they are not in the default context).
      const all = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).then((t) => t.filter((x) => x.type === "page").map((x) => x.url)).catch(() => []);
      // A target can list the typed address for a moment before the rule redirects it: prefer
      // where it ended up, and keep waiting while it is only that address.
      const seen = [...ctx.pages().map((x) => x.url()), ...all].filter((u) => /elon/i.test(u));
      // Enki's search page that cannot open is redirected by Shield a moment later: wait for the
      // expected place, and report where it stayed otherwise.
      landed = seen.find((u) => u.startsWith(want)) ?? seen.find((u) => !/^https?:\/\/[^/]*%20/.test(u) && !/^chrome-error:/.test(u)) ?? seen[0] ?? "";
      if (landed.startsWith(want)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await stopApp(child, browser); // the net log is completed on exit
    await browser.close().catch(() => {});
    const log = await readNetLog(netlog);
    // Searches that land on DuckDuckGo must show it in the log, or the log missed the search.
    const dns = judgeTypedWordsLookup(log, { needHost: expect === "DuckDuckGo" ? "duckduckgo.com" : null });
    const c = knownLimit ? (n, ok, d = "") => { known.push(`${n}: ${ok ? "did not happen here" : "happened"}${d ? ` — ${d}` : ""}`); console.log(`KNOWN LIMIT ${n} — ${ok ? "ok in this run" : "gap reproduced"}${d ? ` — ${d}` : ""}`); } : check;
    c(`${name}: search lands on ${expect}`, landed.startsWith(want), landed || navs.join(" "));
    if (incognito) {
      let onlyQ = false;
      try { const u = new URL(landed); onlyQ = u.origin === "https://duckduckgo.com" && [...u.searchParams.keys()].join() === "q" && u.searchParams.get("q") === QUERY; } catch {}
      c(`${name}: DuckDuckGo gets only q`, onlyQ, landed);
    }
    c(`${name}: never an http(s):// address of the typed words`, !wentOut.length && ![...navs, landed, ...ctx.pages().map((x) => x.url())].some((u) => /^https?:\/\/[^/]*%20/.test(u)), [...wentOut, ...navs.filter((u) => /elon/i.test(u))].join(" "));
    // An empty or unfinished net log is not a DNS verdict either way: say so, distinctly.
    if (dns.result === "incomplete") c(`${name}: net log empty/incomplete — rerun`, false, dns.detail);
    else c(`${name}: no DNS lookup of the typed words`, dns.result === "pass", dns.result === "leak" ? dns.detail : "");
  } finally {
    await stopApp(child, browser);
    await browser?.close().catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
  }
}

await run("new", { engine: "default" }, "DuckDuckGo");
await run("legacy", { engine: "legacy" }, "Enki");
await run("no-enki", { engine: "legacy", withoutEnki: true }, "DuckDuckGo");
await run("no-engine", { engine: "none" }, "DuckDuckGo");
await run("incognito", { engine: "none", incognito: true, shieldIncognito: true }, "DuckDuckGo");
// Known limit (release note): in Incognito the fix needs Shield allowed there.
await run("incognito-no-shield", { engine: "none", incognito: true, shieldIncognito: false, knownLimit: true }, "DuckDuckGo");
if (known.length) console.log(`known limit recorded (not a failure): ${known.length} observation(s)`);
rmSync(APP, { recursive: true, force: true });
// Every host the build tries to reach is in PRIVACY.md (fresh profile, no internet, net log).
await runNetworkHosts(check, { build, allowed });
console.log(results.every(Boolean) ? "omnibox: all passed" : "omnibox: FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
