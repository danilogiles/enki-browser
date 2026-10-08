// Checks a built Enki Browser by using it, not by reading its config: starts it through the
// real launcher with a throwaway profile, then asserts what a user would observe.
//
//   npm run build && npm run verify                    Windows: out/EnkiBrowser
//   node test/verify.mjs                               Linux: out/linux/enki-browser (or ENKI_LINUX_DIR)
//   node test/verify.mjs                               macOS: out/mac-<arch>/Enki Browser.app (or ENKI_MAC_APP)
//   ENKI_LIVE_MODEL=cfp/moonshotai/kimi-k2.6 ...       also run one Act task through a local OmniRoute
//   ENKI_NO_SANDBOX=1 ...                              containers without user namespaces only
//   ENKI_MOCK_KEYCHAIN=1 ...                           macOS CI runners: no keychain prompt to wait on
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const linux = process.platform === "linux";
const mac = process.platform === "darwin";
// Windows: the stub and `current` at the top, the release in app/<version>/. Linux: one folder.
// macOS: the .app, with Enki Browser's files in Contents/Resources/enki.
const macApp = process.env.ENKI_MAC_APP ?? path.join(root, "out", `mac-${process.arch === "arm64" ? "arm64" : "x64"}`, "Enki Browser.app");
const installRoot = linux ? (process.env.ENKI_LINUX_DIR ?? path.join(root, "out", "linux", "enki-browser")) : mac ? macApp : path.join(root, "out", "EnkiBrowser");
const app = linux ? installRoot : mac ? path.join(macApp, "Contents", "Resources", "enki") : path.join(installRoot, "app", readFileSync(path.join(installRoot, "current"), "utf8").trim());
const version = JSON.parse(readFileSync(path.join(app, "version.json"), "utf8"));
const port = 9333;
const results = [];
/** Retries fn until it returns something truthy or the time runs out; returns its last result.
 *  For outcomes that take longer on a slow runner (macOS CI), where a fixed pause was a coin toss. */
async function until(fn, ms) {
  const end = Date.now() + ms;
  let last;
  do {
    last = await fn().catch(() => undefined);
    if (last?.ok ?? last) return last;
    await new Promise((r) => setTimeout(r, 500));
  } while (Date.now() < end);
  return last;
}
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// A local page for the checks that need one; the blocker and fingerprint checks run from it.
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(`<!doctype html><title>Enki Browser check</title><canvas id=c width=200 height=50></canvas>
<script>
  const c = document.getElementById("c").getContext("2d");
  c.font = "20px Arial"; c.fillStyle = "#f60"; c.fillRect(0, 0, 200, 50); c.fillStyle = "#069"; c.fillText("Enki fingerprint", 4, 30);
  const d = c.getImageData(0, 0, 200, 50).data; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0;
  window.canvasHash = h;
</script>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const local = `http://127.0.0.1:${server.address().port}/`;

const userData = mkdtempSync(path.join(os.tmpdir(), "enki-browser-verify-"));
// Started the way the menu entry starts it: on Windows stub → launcher → Chromium, on Linux the
// launcher script → Chromium.
const launcher = linux ? path.join(installRoot, "enki-browser") : mac ? path.join(macApp, "Contents", "MacOS", "Enki Browser") : path.join(installRoot, "EnkiBrowser.exe");
const extraArgs = process.env.ENKI_NO_SANDBOX === "1" ? ["--no-sandbox"] : [];
if (process.env.ENKI_MOCK_KEYCHAIN === "1") extraArgs.push("--use-mock-keychain");
const startedAt = Date.now();
// What the launcher and Chromium print goes to a file, shown if the browser never starts.
const launchLog = path.join(os.tmpdir(), `enki-browser-verify-${process.pid}.log`);
const logFd = openSync(launchLog, "w");
const proc = spawn(launcher, [`--remote-debugging-port=${port}`, ...extraArgs, "about:blank"], {
  env: { ...process.env, ENKI_BROWSER_USER_DATA: userData },
  stdio: ["ignore", logFd, logFd],
});

let browser;
let cdp;
try {
  // The launcher exits at once; the browser it started is what answers on the debug port.
  for (let i = 0; i < 60 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 500));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
  }
  if (!browser) {
    const tail = readFileSync(launchLog, "utf8").split("\n").slice(-60).join("\n");
    console.log(`--- launcher and browser output (${launchLog}) ---\n${tail}\n---`);
    throw new Error("Enki Browser did not start (no debug endpoint after 30s).");
  }
  const ctx = browser.contexts()[0];
  cdp = await browser.newBrowserCDPSession();
  const product = (await cdp.send("Browser.getVersion")).product;
  // The Chromium major must match the one this build pinned, not one hard-coded here.
  check("browser starts through the launcher", product.includes(`Chrome/${version.chromium.split(".")[0]}.`), product);

  // ---- built-in extensions
  // Poll rather than wait a fixed time: on a slow CI runner the extensions' service workers came
  // up after a 2.5 s pause, failing this check while every extension later worked.
  let extIds = new Set();
  for (let i = 0; i < 40 && !(extIds.has(version.enkiExtensionId) && extIds.size >= 2); i++) {
    await new Promise((r) => setTimeout(r, 500));
    const targets = (await cdp.send("Target.getTargets")).targetInfos;
    extIds = new Set(targets.map((t) => /^chrome-extension:\/\/([a-p]{32})\//.exec(t.url)?.[1]).filter(Boolean));
  }
  check("Enki is loaded with its fixed id", extIds.has(version.enkiExtensionId), [...extIds].join(", "));
  check("the blocker is loaded", extIds.size >= 2, `${extIds.size} extensions running`);

  let page = await ctx.newPage();

  // ---- search engine: read what the settings page shows the user
  await page.goto("chrome://settings/search");
  await page.waitForTimeout(1500);
  const settingsText = await page.evaluate(() => {
    const walk = (n) => (n.shadowRoot ? walk(n.shadowRoot) : "") + [...n.childNodes].map((c) => (c.nodeType === 3 ? c.textContent : c.nodeType === 1 ? walk(c) : "")).join(" ");
    return walk(document.body).replace(/\s+/g, " ");
  });
  // The default is the one shown with a "Change" button: Enki, which answers in a tab.
  check("Enki is the address bar's default search engine", /Enki Change/.test(settingsText), settingsText.match(/\S+ Change/)?.[0] ?? "");
  // What a search from the address bar opens: Enki's answer page, at the URL the engine builds.
  await page.goto(`chrome-extension://${version.enkiExtensionId}/src/sidepanel/index.html?q=${encodeURIComponent("enki verify")}`);
  await page.waitForTimeout(1200);
  check("an address bar search opens Enki's answer page", (await page.title()) === "enki verify — Enki", await page.title());

  // ---- HTTPS: a plain-http address must end up on https or behind the warning page
  await page.goto("http://example.com/").catch(() => undefined);
  await page.waitForTimeout(1000);
  check("http:// is upgraded to https://", page.url().startsWith("https://"), page.url());

  // ---- tracker/ad blocking, observed as a failed request from an ordinary page
// uBlock either refuses a request (ERR_BLOCKED_BY_CLIENT) or, for scripts whose absence would
  // break the page, answers it with a neutered stub from inside the extension. Both count; what
  // must never happen is the real script arriving from the ad network.
  const trackers = ["https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", "https://micro.rubiconproject.com/prebid/dynamic/7470.js", "https://cdn.permutive.com/sdk.js"];
  const outcome = new Map();
  page.on("requestfailed", (r) => { if (trackers.includes(r.url())) outcome.set(r.url(), r.failure()?.errorText ?? "failed"); });
  page.on("response", (r) => { const from = r.request().redirectedFrom()?.url(); if (from && trackers.includes(from) && r.url().startsWith("chrome-extension://")) outcome.set(from, "neutered"); else if (trackers.includes(r.url()) && r.status() === 200) outcome.set(r.url(), "LOADED"); });
  await page.goto("https://example.com/");
  await page.evaluate((urls) => urls.forEach((u) => { const el = document.createElement("script"); el.src = u; document.head.appendChild(el); }), trackers);
  await page.waitForTimeout(3000);
  const summary = trackers.map((u) => `${new URL(u).hostname}: ${outcome.get(u) ?? "no request seen"}`);
  check("ad and tracker scripts never load", trackers.every((u) => /BLOCKED_BY_CLIENT|neutered/.test(outcome.get(u) ?? "")), summary.join(", "));

  // ---- the Shields button: what was blocked on this site, and Shields down for it
  const shieldsPage = await page.context().newPage();
  await shieldsPage.goto(`chrome-extension://${version.shieldExtensionId}/options.html`);
  const siteTab = await shieldsPage.evaluate(async () => (await chrome.tabs.query({ url: "https://example.com/*" }))[0]?.id);
  const openShields = async () => {
    await shieldsPage.goto(`chrome-extension://${version.shieldExtensionId}/popup.html?tab=${siteTab}`);
    await shieldsPage.waitForFunction(() => document.documentElement.dataset.ready === "true", null, { timeout: 15000 }).catch(() => undefined);
    return shieldsPage.evaluate(() => ({ host: document.getElementById("host").textContent, count: Number(document.getElementById("count").textContent), up: document.getElementById("toggle").getAttribute("aria-checked") === "true", levels: !document.getElementById("level").disabled }));
  };
  const before = await openShields();
  check("the Shields panel counts what was blocked on the site", before.host === "example.com" && before.count >= trackers.length && before.up, JSON.stringify(before));
  check("the Shields panel reaches uBlock's per-site mode", before.levels);
  const badgeText = await shieldsPage.evaluate((tabId) => chrome.action.getBadgeText({ tabId }), siteTab);
  check("the Shields button shows the number blocked", badgeText === String(before.count), `badge "${badgeText}"`);
  const firstRun = JSON.parse(readFileSync(mac ? path.join(app, "initial_preferences") : path.join(app, "chromium", "initial_preferences"), "utf8"));
  check("new profiles get the Shields button pinned next to the address bar", firstRun.extensions?.pinned_extensions?.includes(version.shieldExtensionId), JSON.stringify(firstRun.extensions?.pinned_extensions));
  const loadTrackers = async () => {
    outcome.clear();
    await page.waitForLoadState("load").catch(() => undefined);
    await page.evaluate((urls) => urls.forEach((u) => { const el = document.createElement("script"); el.src = u; document.head.appendChild(el); }), trackers);
    await page.waitForTimeout(3000);
    return trackers.map((u) => outcome.get(u) ?? "no request seen");
  };
  await shieldsPage.click("#toggle"); // Shields down, and the panel reloads the tab
  await page.waitForTimeout(1500);
  // uBlock applies the site's new mode asynchronously; try again until it has.
  const down = (await until(async () => {
    const o = await loadTrackers();
    return { ok: o.some((x) => !/BLOCKED_BY_CLIENT|neutered/.test(x)), o };
  }, 15000))?.o ?? [];
  check("Shields down lets a site's trackers through", (await openShields()).up === false && down.some((o) => !/BLOCKED_BY_CLIENT|neutered/.test(o)), down.join(", "));
  await shieldsPage.click("#toggle"); // and back up
  await page.waitForTimeout(1500);
  const up = (await until(async () => {
    const o = await loadTrackers();
    return { ok: o.every((x) => /BLOCKED_BY_CLIENT|neutered/.test(x)), o };
  }, 15000))?.o ?? [];
  check("Shields up blocks them again", up.every((o) => /BLOCKED_BY_CLIENT|neutered/.test(o)), up.join(", "));
  // Shields' per-site choices name sites the user visits: stored sealed, never as host names.
  const sealedSites = await shieldsPage.evaluate(async () => {
    const sites = await import(chrome.runtime.getURL("sites.js"));
    await sites.setSite("example.com", { scripts: "block" });
    await sites.setForget("example.com", true);
    const raw = await chrome.storage.local.get(["shields:sites", "shields:forget"]);
    const readBack = (await sites.sites())["example.com"]?.scripts;
    await sites.setSite("example.com", { scripts: undefined });
    await sites.setForget("example.com", false);
    return { sites: raw["shields:sites"], forget: raw["shields:forget"], readBack };
  });
  check("Shields' per-site settings are stored encrypted",
    /^enc:v1:/.test(sealedSites.sites) && /^enc:v1:/.test(sealedSites.forget) && !JSON.stringify(sealedSites).replace(/"readBack":"block"/, "").includes("example.com") && sealedSites.readBack === "block",
    JSON.stringify({ sites: String(sealedSites.sites).slice(0, 20), readBack: sealedSites.readBack }));
  await shieldsPage.close();
  await page.goto(local);

  // ---- fingerprinting: the same drawing must not read back identically across page loads
  const first = await page.evaluate(() => window.canvasHash);
  await page.reload();
  const second = await page.evaluate(() => window.canvasHash);
  check("canvas readings carry per-load noise", first !== second, `${first} vs ${second}`);

  // ---- third-party cookies: what the settings page says is in effect
  await page.goto("chrome://settings/cookies");
  await page.waitForTimeout(1500);
  const cookieState = await page.evaluate(() => {
    const find = (n) => {
      for (const el of [n, ...(n.shadowRoot ? [n.shadowRoot] : []), ...n.querySelectorAll?.("*") ?? []]) {
        if (el !== n && el.shadowRoot) { const r = find(el.shadowRoot); if (r) return r; }
        if (el.getAttribute?.("aria-checked") === "true" && /third-party/i.test(el.textContent || el.getAttribute("label") || "")) return el.getAttribute("label") || el.textContent;
        if (el.checked === true && /block/i.test(el.getAttribute?.("label") || "")) return el.getAttribute("label");
      }
      return null;
    };
    return find(document.body);
  });
  check("third-party cookies are blocked", /block/i.test(cookieState ?? ""), cookieState ?? "no checked option found");

  // ---- closing the last window must end the browser, or a staged update never installs.
  // Not on macOS: Chromium there has no such setting (a Mac app runs until it is quit, ⌘Q, like
  // every Mac app), and there is no updater waiting for the browser to close.
  if (!mac) {
    await page.goto("chrome://settings/system");
    await page.waitForTimeout(1500);
    const background = await page.evaluate(() => {
      const all = (n, acc = []) => { for (const el of n.querySelectorAll("*")) { acc.push(el); if (el.shadowRoot) all(el.shadowRoot, acc); } return acc; };
      const row = all(document).find((el) => el.tagName === "SETTINGS-TOGGLE-BUTTON" && /background/i.test(el.getAttribute("label") ?? el.label ?? ""));
      return row ? { label: row.getAttribute("label") ?? row.label, checked: !!row.checked } : null;
    });
    check("the browser does not keep running after it is closed", background?.checked === false, background ? `${background.label}: ${background.checked ? "on" : "off"}` : "toggle not found");
  }

  // ---- Enki Shield: phishing protection checked on this device
  const shieldPage = `chrome-extension://${version.shieldExtensionId}/blocked.html?url=about%3Ablank`;
  await page.goto(shieldPage).catch(() => undefined); // may interrupt a pending redirect
  await page.waitForTimeout(500);
  let status = null;
  for (let i = 0; i < 60 && !(status?.domains > 5000); i++) {
    status = await page.evaluate(() => chrome.runtime.sendMessage({ type: "shield:status" })).catch(() => null);
    if (!(status?.domains > 5000)) await page.waitForTimeout(1000);
  }
  check("Enki Shield has downloaded the phishing list", status?.domains > 5000, status ? `${status.domains} domains, ${status.pages} pages` : "no status");

  // Every visit starts from a blank page, and a warning only counts if it is the warning for
  // *this* URL: a leftover warning from the previous visit once made two checks pass by accident.
  const warningFor = (url) => `chrome-extension://${version.shieldExtensionId}/blocked.html?url=${encodeURIComponent(url)}`;
  const visit = async (url) => {
    await page.goto("about:blank");
    const error = await page.goto(url).then(() => null, (e) => /net::(ERR_[A-Z_]+)/.exec(e.message)?.[1] ?? "error");
    for (let i = 0; i < 20 && page.url() !== warningFor(url); i++) await page.waitForTimeout(250);
    return { warned: page.url() === warningFor(url), error, at: page.url() };
  };
  const canary = "https://check.enki-shield.invalid/login";
  check("the Shield test address shows the warning", (await visit(canary)).warned);

  // A real entry from the list: the rule refuses it before any DNS lookup or connection, so the
  // test never touches the phishing site.
  await page.goto(shieldPage).catch(() => undefined);
  await page.waitForTimeout(500);
  const sample = (await page.evaluate(() => chrome.runtime.sendMessage({ type: "shield:sample" })))?.domain;
  check("a domain on the live phishing list is refused", !!sample && (await visit(`https://${sample}/`)).warned, sample ?? "no sample");

  check("a listed page on a shared host shows the warning", (await visit("https://enki-shield-page.invalid/phish")).warned);
  // .invalid never resolves, so an unblocked visit fails with a DNS error, not ERR_BLOCKED_BY_CLIENT.
  const other = await visit("https://enki-shield-page.invalid/other");
  check("other pages on that host are not blocked", !other.warned && other.error !== "ERR_BLOCKED_BY_CLIENT", other.error ?? other.at);

  await visit(canary);
  const failed = page.waitForEvent("requestfailed", { predicate: (r) => r.url().startsWith(canary), timeout: 10000 }).catch(() => null);
  await page.click("#proceed");
  const reason = (await failed)?.failure()?.errorText ?? "no request";
  check("'open it anyway' lets that one site through", /NAME_NOT_RESOLVED/.test(reason), reason);
  // Let that navigation settle into its error page; left running, it interrupts the next goto.
  await page.waitForLoadState("load").catch(() => undefined);
  await page.goto("about:blank").catch(() => undefined);
  await page.waitForTimeout(500);

  // ---- the product: its start page, its name, its look
  await page.goto("chrome://newtab/").catch(() => page.goto("chrome://newtab/"));
  await page.waitForTimeout(1200);
  const home = await page.evaluate(() => ({ box: !!document.querySelector("textarea"), text: document.body.innerText }));
  check("a new tab opens Enki Home", home.box && /Enki/.test(home.text), home.text.split("\n").filter(Boolean).slice(0, 3).join(" | "));

  const deepText = (url) => page.goto(url).then(() => page.waitForTimeout(1500)).then(() => page.evaluate(() => {
    const walk = (n) => (n.shadowRoot ? walk(n.shadowRoot) : "") + [...n.childNodes].map((c) => (c.nodeType === 3 ? c.textContent : c.nodeType === 1 ? walk(c) : "")).join(" ");
    return walk(document.body).replace(/\s+/g, " ");
  }));
  const about = await deepText("chrome://settings/help");
  // The credits keep Chromium's name on purpose ("The Chromium Authors", "made possible by the
  // Chromium open source project"); anywhere else the product must be Enki Browser.
  const credits = /The Chromium Authors|Chromium open source project/g;
  check("the About page names Enki Browser, not Chromium", /Enki Browser/.test(about) && !/\bChromium\b(?!\.)/.test(about.replace(/ungoogled-chromium/gi, "").replace(credits, "")), about.match(/[^.]{0,40}Enki Browser[^.]{0,40}/)?.[0]?.trim() ?? "");
  const chromiumVersion = version.chromium.split("-")[0];
  const versionLine = about.match(/Enki Browser \S+ · Version [^)]*\)/)?.[0] ?? "";
  check("the About page shows Enki Browser's version", versionLine.startsWith(`Enki Browser ${version.enkiBrowser} · Version ${chromiumVersion}`), versionLine || about.match(/.{0,60}Version.{0,60}/)?.[0] || "no version line");
  check("the About page credits the Chromium project", /The Chromium Authors/.test(about) && /Chromium open source project/.test(about));
  // The logo the About page shows, compared with Chromium's own at the same version.
  const logo = await page.goto("chrome://theme/current-channel-logo@2x").then((r) => r.body()).catch(() => null);
  const refs = path.join(root, "cache", `chromium-logos-${chromiumVersion}`);
  const isChromiums = !!logo && existsSync(refs) && readdirSync(refs).some((f) => readFileSync(path.join(refs, f)).equals(logo));
  check("the About page shows Enki's logo, not Chromium's", !!logo && logo.length > 100 && !isChromiums, logo ? `${logo.length} bytes` : "no logo");
  // Read the Theme row itself: the page's side menu also says "About Enki Browser", which would
  // satisfy a search of the whole page without proving anything about the theme.
  await page.goto("chrome://settings/appearance");
  await page.waitForTimeout(1500);
  const themeRow = await page.evaluate(() => {
    const all = (n, acc = []) => { for (const el of n.querySelectorAll("*")) { acc.push(el); if (el.shadowRoot) all(el.shadowRoot, acc); } return acc; };
    const row = all(document).find((el) => el.id === "themeRow");
    return row ? (row.shadowRoot ?? row).textContent.replace(/\s+/g, " ").trim() : "";
  });
  // No custom theme: the Theme row offers no "Reset to default", so the window follows the
  // system light or dark mode like other browsers.
  check("the window follows the system theme (no custom theme)", !!themeRow && !/Reset to default|Redefinir|Restablecer/i.test(themeRow), themeRow || "theme row not found");

  if (mac) {
    const info = path.join(macApp, "Contents", "Info.plist");
    const read = (key) => { try { return execFileSync("plutil", ["-extract", key, "raw", info]).toString().trim(); } catch { return ""; } };
    check("the app is called Enki Browser, with its own bundle id", read("CFBundleName") === "Enki Browser" && read("CFBundleIdentifier") === "io.github.danilogiles.EnkiBrowser", `${read("CFBundleName")} · ${read("CFBundleIdentifier")}`);
    let signed = "";
    try { execFileSync("codesign", ["--verify", "--deep", "--strict", macApp], { stdio: "pipe" }); } catch (e) { signed = e.stderr?.toString().trim() || "invalid"; }
    check("the app's signature is intact (nothing was changed after signing)", signed === "", signed);
    // The launcher execs Chromium: the browser runs in the process macOS started, so it is one app
    // (the Dock's icon, links from other apps), not a launcher and a separate Chromium.
    const comm = execFileSync("ps", ["-o", "comm=", "-p", String(proc.pid)]).toString().trim();
    check("the browser runs in the app's own process", comm.endsWith("Enki Browser.app/Contents/MacOS/Chromium"), comm);
  } else if (!linux) {
    const winInfo = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `$c = Join-Path '${app}' 'chromium\\chrome.exe'; ` +
      `(Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $c -and $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle; ` +
      `(Get-Item $c).VersionInfo.FileDescription`]).toString().trim().split(/\r?\n/);
    check("the window title ends in Enki Browser", / - Enki Browser$/.test(winInfo[0] ?? ""), winInfo[0] ?? "no window");
    check("chrome.exe describes itself as Enki Browser", winInfo.at(-1) === "Enki Browser", winInfo.at(-1));
  }

  if (mac) {
    // The first-run defaults go through Chromium's own folder and must not stay there.
    const leftover = path.join(os.homedir(), "Library", "Application Support", "Chromium", "Chromium Initial Preferences");
    const wait = 70000 - (Date.now() - startedAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    check("the first-run defaults are removed from Chromium's folder afterwards", !existsSync(leftover), leftover);
  }

  // ---- the assistant itself
  await page.goto(`chrome-extension://${version.enkiExtensionId}/src/sidepanel/index.html`);
  await page.waitForTimeout(1200);
  const panel = await page.evaluate(() => document.body.innerText);
  // With no provider chosen yet, the panel opens straight into setup; that is the first-run view.
  check("the Enki panel renders", /Enki|Settings/.test(panel) && /Model/.test(panel), panel.split("\n").slice(0, 3).join(" | "));

  // ---- shred (one site) and burn (everything), last: burning closes every tab
  // (the same browser context as the rest of the run)
  const site = await ctx.newPage();
  await site.goto("https://example.com/");
  await site.evaluate(() => { localStorage.setItem("enki-verify", "1"); document.cookie = "enki_verify=1; max-age=3600; path=/"; });
  const otherSite = await ctx.newPage();
  await otherSite.goto("https://example.org/");
  await otherSite.evaluate(() => localStorage.setItem("enki-verify", "1"));
  const panelFor = async (url) => {
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${version.shieldExtensionId}/options.html`);
    const tabId = await p.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, url);
    await p.goto(`chrome-extension://${version.shieldExtensionId}/popup.html?tab=${tabId}`);
    // Clicking before the panel's script has wired its buttons does nothing (the site name shows
    // earlier than that, and waiting for it still lost the click on a slow macOS runner).
    await p.waitForFunction(() => document.documentElement.dataset.ready === "true", null, { timeout: 15000 }).catch(() => undefined);
    return p;
  };
  const shred = await panelFor("https://example.com/*");
  await shred.click("#shred"); await shred.click("#burn-go").catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1500));
  const check1 = await ctx.newPage();
  await check1.goto("https://example.com/");
  const shredded = await check1.evaluate(() => ({ storage: localStorage.getItem("enki-verify"), cookie: document.cookie }));
  const otherKept = await otherSite.evaluate(() => localStorage.getItem("enki-verify"));
  check("Shred this site deletes that site's data and keeps others'", !shredded.storage && !/enki_verify/.test(shredded.cookie) && otherKept === "1", JSON.stringify({ shredded, otherKept }));
  const burn = await panelFor("https://example.org/*");
  await burn.click("#burn"); await burn.click("#burn-go").catch(() => undefined);
  // Burning closes every tab and then clears the data; wait for it to finish rather than guess.
  await until(async () => ctx.pages().filter((p) => !p.isClosed()).length <= 1, 20000);
  await new Promise((r) => setTimeout(r, 1500));
  const left = ctx.pages().filter((p) => !p.isClosed());
  const after = left[0] ?? await ctx.newPage();
  await after.goto("https://example.org/");
  const burnedStorage = await after.evaluate(() => localStorage.getItem("enki-verify"));
  await after.goto("chrome://history/");
  await after.waitForTimeout(1500);
  const historyText = await after.evaluate(() => { const walk = (n) => (n.shadowRoot ? walk(n.shadowRoot) : "") + [...n.childNodes].map((c) => (c.nodeType === 3 ? c.textContent : c.nodeType === 1 ? walk(c) : "")).join(" "); return walk(document.body); });
  check("Burn all data closes every tab and deletes history and site data", left.length <= 1 && !burnedStorage && !/example\.com/.test(historyText), `${left.length} tab(s) left · storage ${burnedStorage} · history mentions example.com: ${/example\.com/.test(historyText)}`);
  page = after;

  if (process.env.ENKI_LIVE_MODEL) {
    const win = await page.evaluate(async () => (await chrome.windows.create({ url: "https://example.com/" })).id);
    await page.evaluate(async (model) => chrome.storage.local.set({
      "enki:settings": { preset: "omniroute", baseUrl: "http://localhost:20128/v1", apiKey: "", model, vision: false, attachScreenshot: false, maxSteps: 8, requestTimeoutSec: 90, saveConversations: false },
      "enki:mode": "act",
    }), process.env.ENKI_LIVE_MODEL);
    await page.goto(`chrome-extension://${version.enkiExtensionId}/src/sidepanel/index.html?window=${win}`);
    await page.waitForTimeout(1200);
    await page.fill("textarea", "Vá para https://pt.wikipedia.org e me diga qual é o artigo em destaque de hoje.");
    await page.press("textarea", "Enter");
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => !document.querySelector("button[title='Stop']"), null, { timeout: 240000 });
    const text = await page.evaluate(() => document.body.innerText);
    const tools = /(\d+) tool results successful/.exec(text)?.[1] ?? "0";
    // Free models wander (one run spent its 8 steps on Wikipedia's featured *image*); show where.
    if (!/Response finished/.test(text)) console.log(text.split("\n").slice(-25).join("\n"));
    check("Enki completes an Act task inside Enki Browser", Number(tools) >= 2 && /Response finished/.test(text), `${tools} tools · ${text.split("\n").find((l) => /destaque/i.test(l) && !/Vá para/.test(l)) ?? ""}`);
  }
} finally {
  // Over CDP, browser.close() only disconnects; Browser.close actually quits Chromium.
  await cdp?.send("Browser.close").catch(() => undefined);
  await browser?.close().catch(() => undefined);
  proc.kill();
  server.close();
  await new Promise((r) => setTimeout(r, 1500));
  try { rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); }
  catch { console.log(`(left temporary profile at ${userData})`); }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
