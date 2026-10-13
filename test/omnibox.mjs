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
//
//   xvfb-run -a node test/omnibox.mjs        build in out/linux/enki-browser (or ENKI_LINUX_DIR)
//   ENKI_NO_SANDBOX=1 ...                    containers without user namespaces only
import { execSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = process.env.ENKI_LINUX_DIR ?? path.join(root, "out", "linux", "enki-browser");
// Without a build: the static rule and the helper agree, and only typed words match.
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
  if (!ok || !fb) process.exit(1);
  if (process.argv.includes("--unit")) process.exit(0);
}
if (process.platform !== "linux") { console.log("SKIP omnibox: Linux only (xdotool types into the real address bar)"); process.exit(0); }
const version = JSON.parse(readFileSync(path.join(build, "version.json"), "utf8"));
const ENKI = `chrome-extension://${version.enkiExtensionId}/src/sidepanel/index.html?q=`;
const QUERY = "elon musk github replacemente";
const port = 9334;
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const prefs = JSON.parse(readFileSync(path.join(build, "chromium", "initial_preferences"), "utf8"));
const legacyEngine = {
  template_url_data: {
    short_name: "Enki", keyword: "enki", url: `${ENKI}{searchTerms}`,
    favicon_url: `chrome-extension://${version.enkiExtensionId}/public/icons/icon32.png`,
    safe_for_autoreplace: false, input_encodings: ["UTF-8"],
  },
};

async function run(name, { engine, withoutEnki = false }, expect) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), `enki-omnibox-${name}-`));
  const app = path.join(tmp, "app");
  cpSync(build, app, { recursive: true });
  if (withoutEnki) rmSync(path.join(app, "extensions", "enki"), { recursive: true, force: true });
  const p = { ...prefs };
  if (engine === "none") delete p.default_search_provider_data;
  else if (engine === "legacy") p.default_search_provider_data = legacyEngine;
  // Chromium on Linux reads initial_preferences from its own folder when the profile is created.
  writeFileSync(path.join(app, "chromium", "initial_preferences"), JSON.stringify(p));
  const netlog = path.join(tmp, "netlog.json");
  const args = [`--remote-debugging-port=${port}`, `--log-net-log=${netlog}`, "about:blank"];
  if (process.env.ENKI_NO_SANDBOX === "1") args.unshift("--no-sandbox");
  const child = spawn(path.join(app, "enki-browser"), args, { env: { ...process.env, ENKI_BROWSER_USER_DATA: path.join(tmp, "data") }, stdio: "ignore" });
  let browser;
  try {
    for (let i = 0; i < 60 && !browser; i++) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
      if (!browser) await new Promise((r) => setTimeout(r, 500));
    }
    const ctx = browser.contexts()[0];
    await new Promise((r) => setTimeout(r, 4000)); // extensions up, first-run tabs open
    const page = await ctx.newPage();
    await page.bringToFront();
    const navs = []; // main-frame addresses that committed (a redirected request never commits)
    const watch = (pg) => pg.on("framenavigated", (f) => { if (f === pg.mainFrame()) navs.push(f.url()); });
    ctx.pages().forEach(watch); ctx.on("page", watch);
    // A navigation to the typed words that went to the network (failed there) rather than being
    // turned into a search before any lookup.
    const wentOut = [];
    ctx.on("requestfailed", (r) => { if (/^https?:\/\/[^/]*%20/.test(r.url())) wentOut.push(r.url()); });
    execSync(`xdotool search --sync --onlyvisible --class enki-browser windowactivate --sync 2>/dev/null; sleep 0.5; xdotool key ctrl+l; sleep 0.5; xdotool type --delay 20 "${QUERY}"; sleep 0.8; xdotool key Return`, { shell: "/bin/bash" });
    let landed = "";
    for (let i = 0; i < 20; i++) {
      landed = ctx.pages().map((x) => x.url()).find((u) => /elon/i.test(u)) ?? "";
      if (landed && !/^chrome-error:/.test(landed)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await browser.close().catch(() => {});
    child.kill();
    await new Promise((r) => setTimeout(r, 2500)); // the net log is completed on exit
    const log = existsSync(netlog) ? readFileSync(netlog, "utf8") : "";
    const leaked = (log.match(/"host":"[^"]*"/g) ?? []).filter((h) => /elon|%20/i.test(h));
    check(`${name}: search lands on ${expect}`, landed.startsWith(expect === "Enki" ? ENKI : "https://duckduckgo.com/?q="), landed || navs.join(" "));
    check(`${name}: never an http(s):// address of the typed words`, !wentOut.length && ![...navs, landed, ...ctx.pages().map((x) => x.url())].some((u) => /^https?:\/\/[^/]*%20/.test(u)), [...wentOut, ...navs.filter((u) => /elon/i.test(u))].join(" "));
    check(`${name}: no DNS lookup of the typed words`, log.length > 0 && leaked.length === 0, leaked.slice(0, 2).join(" "));
  } finally {
    try { child.kill(); } catch {}
    rmSync(tmp, { recursive: true, force: true });
  }
}

await run("new", { engine: "default" }, "DuckDuckGo");
await run("legacy", { engine: "legacy" }, "Enki");
await run("no-enki", { engine: "legacy", withoutEnki: true }, "DuckDuckGo");
await run("no-engine", { engine: "none" }, "DuckDuckGo");
console.log(results.every(Boolean) ? "omnibox: all passed" : "omnibox: FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
