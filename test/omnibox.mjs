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
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { checkAllowlist, runNetworkHosts } from "./network-hosts.mjs";

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
  allowed = checkAllowlist((n, pass, d = "") => { listed &&= pass; console.log(`${pass ? "PASS" : "FAIL"} ${n}${d ? ` — ${d}` : ""}`); });
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
// The launcher is a bash script that runs Chromium as its child: stop the whole process group,
// or Chromium outlives it and keeps the debugging port (and the profile) for the next case.
const launchApp = (args, userData) => spawn(path.join(APP, "enki-browser"), args, { env: { ...process.env, ENKI_BROWSER_USER_DATA: userData }, stdio: ["ignore", "ignore", "pipe"], detached: true });
async function stopApp(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const gone = new Promise((r) => child.once("exit", r));
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  if (await Promise.race([gone.then(() => true), sleep(8000).then(() => false)])) return;
  try { process.kill(-child.pid, "SIGKILL"); } catch {}
  await Promise.race([gone, sleep(3000)]);
}
async function portFree() {
  for (let i = 0; i < 40; i++) {
    if (!(await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false))) return true;
    await sleep(250);
  }
  return false;
}
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
  if (!(await portFree())) { check(`${name}: debugging port ${port} is free`, false, "a browser from an earlier run still holds it"); return; }
  if (incognito) {
    // First run creates the profile; then "Allow in Incognito" is set (or left off) for Shield the
    // way a person's click stores it on Linux: Preferences only, Secure Preferences untouched.
    const first = launch(args.filter((a) => !a.startsWith("--log-net-log")));
    const pf = path.join(userData, "Default", "Preferences");
    for (let i = 0; i < 60 && !existsSync(pf) && first.exitCode === null && first.signalCode === null; i++) await sleep(500);
    await sleep(4000); // extensions registered in the new profile
    await stopApp(first); await portFree();
    let pr = null;
    try { pr = JSON.parse(readFileSync(pf, "utf8")); } catch (e) {
      check(`${name}: first run created the profile`, false, `${e.message}${stderr ? ` — ${stderr.trim().split("\n").slice(-3).join(" | ")}` : ""}`);
      rmSync(tmp, { recursive: true, force: true });
      return;
    }
    const sid = version.shieldExtensionId;
    ((pr.extensions ??= {}).settings ??= {})[sid] = { ...(pr.extensions.settings[sid] ?? {}), incognito: shieldIncognito };
    writeFileSync(pf, JSON.stringify(pr));
  }
  const child = launch(args);
  let browser;
  try {
    for (let i = 0; i < 60 && !browser; i++) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
      if (!browser) {
        if (child.exitCode !== null || child.signalCode !== null) break; // it will not come up
        await sleep(500);
      }
    }
    if (!browser) {
      // Not a pass and not a crash: say why, and fail the case's checks.
      const why = child.exitCode !== null || child.signalCode !== null ? `exited (${child.exitCode ?? child.signalCode})` : "no DevTools answer in 30 s";
      check(`${name}: browser started`, false, `${why}${stderr ? ` — ${stderr.trim().split("\n").slice(-3).join(" | ")}` : ""}`);
      return;
    }
    const ctx = browser.contexts()[0];
    await new Promise((r) => setTimeout(r, 4000)); // extensions up, first-run tabs open
    const page = await ctx.newPage();
    await page.bringToFront();
    if (incognito) {
      const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${version.shieldExtensionId}/`));
      const allowed = sw ? await sw.evaluate(() => chrome.extension.isAllowedIncognitoAccess()) : null;
      check(`${name}: Shield ${shieldIncognito ? "is" : "is not"} allowed in Incognito (test profile)`, allowed === shieldIncognito, String(allowed));
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
    await browser.close().catch(() => {});
    await stopApp(child); // the net log is completed on exit
    const log = existsSync(netlog) ? readFileSync(netlog, "utf8") : "";
    const leaked = (log.match(/"host":"[^"]*"/g) ?? []).filter((h) => /elon|%20/i.test(h));
    const c = knownLimit ? (n, ok, d = "") => { known.push(`${n}: ${ok ? "did not happen here" : "happened"}${d ? ` — ${d}` : ""}`); console.log(`KNOWN LIMIT ${n} — ${ok ? "ok in this run" : "gap reproduced"}${d ? ` — ${d}` : ""}`); } : check;
    c(`${name}: search lands on ${expect}`, landed.startsWith(want), landed || navs.join(" "));
    if (incognito) {
      let onlyQ = false;
      try { const u = new URL(landed); onlyQ = u.origin === "https://duckduckgo.com" && [...u.searchParams.keys()].join() === "q" && u.searchParams.get("q") === QUERY; } catch {}
      c(`${name}: DuckDuckGo gets only q`, onlyQ, landed);
    }
    c(`${name}: never an http(s):// address of the typed words`, !wentOut.length && ![...navs, landed, ...ctx.pages().map((x) => x.url())].some((u) => /^https?:\/\/[^/]*%20/.test(u)), [...wentOut, ...navs.filter((u) => /elon/i.test(u))].join(" "));
    c(`${name}: no DNS lookup of the typed words`, log.length > 0 && leaked.length === 0, leaked.slice(0, 2).join(" "));
  } finally {
    await browser?.close().catch(() => {});
    await stopApp(child);
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
