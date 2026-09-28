// Checks a built Enki Browser by using it, not by reading its config: starts it through the
// real launcher with a throwaway profile, then asserts what a user would observe.
//
//   npm run build && npm run verify
//   ENKI_LIVE_MODEL=cfp/moonshotai/kimi-k2.6 npm run verify   also run one Act task through a local OmniRoute
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(root, "out", "EnkiBrowser");
const version = JSON.parse(readFileSync(path.join(app, "version.json"), "utf8"));
const port = 9333;
const results = [];
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
const proc = spawn(path.join(app, "EnkiBrowser.exe"), [`--remote-debugging-port=${port}`, "about:blank"], {
  env: { ...process.env, ENKI_BROWSER_USER_DATA: userData },
  stdio: "ignore",
});

let browser;
let cdp;
try {
  // The launcher exits at once; the browser it started is what answers on the debug port.
  for (let i = 0; i < 60 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 500));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
  }
  if (!browser) throw new Error("Enki Browser did not start (no debug endpoint after 30s).");
  const ctx = browser.contexts()[0];
  cdp = await browser.newBrowserCDPSession();
  const product = (await cdp.send("Browser.getVersion")).product;
  check("browser starts through the launcher", /Chrome\/153\./.test(product), product);

  // ---- built-in extensions
  await new Promise((r) => setTimeout(r, 2500));
  const targets = (await cdp.send("Target.getTargets")).targetInfos;
  const extIds = new Set(targets.map((t) => /^chrome-extension:\/\/([a-p]{32})\//.exec(t.url)?.[1]).filter(Boolean));
  check("Enki is loaded with its fixed id", extIds.has(version.enkiExtensionId), [...extIds].join(", "));
  check("the blocker is loaded", extIds.size >= 2, `${extIds.size} extensions running`);

  const page = await ctx.newPage();

  // ---- search engine: read what the settings page shows the user
  await page.goto("chrome://settings/search");
  await page.waitForTimeout(1500);
  const settingsText = await page.evaluate(() => {
    const walk = (n) => (n.shadowRoot ? walk(n.shadowRoot) : "") + [...n.childNodes].map((c) => (c.nodeType === 3 ? c.textContent : c.nodeType === 1 ? walk(c) : "")).join(" ");
    return walk(document.body).replace(/\s+/g, " ");
  });
  // The engine list also names DuckDuckGo; the default is the one shown with a "Change" button.
  check("DuckDuckGo is the default search engine", /DuckDuckGo Change/.test(settingsText), settingsText.match(/S+ Change/)?.[0] ?? "");

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

  // ---- closing the last window must end the browser, or a staged update never installs
  await page.goto("chrome://settings/system");
  await page.waitForTimeout(1500);
  const background = await page.evaluate(() => {
    const all = (n, acc = []) => { for (const el of n.querySelectorAll("*")) { acc.push(el); if (el.shadowRoot) all(el.shadowRoot, acc); } return acc; };
    const row = all(document).find((el) => el.tagName === "SETTINGS-TOGGLE-BUTTON" && /background/i.test(el.getAttribute("label") ?? el.label ?? ""));
    return row ? { label: row.getAttribute("label") ?? row.label, checked: !!row.checked } : null;
  });
  check("the browser does not keep running after it is closed", background?.checked === false, background ? `${background.label}: ${background.checked ? "on" : "off"}` : "toggle not found");

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
  check("the About page names Enki Browser, not Chromium", /Enki Browser/.test(about) && !/\bChromium\b(?!\.)/.test(about.replace(/ungoogled-chromium/gi, "")), about.match(/[^.]{0,40}Enki Browser[^.]{0,40}/)?.[0]?.trim() ?? "");
  // Read the Theme row itself: the page's side menu also says "About Enki Browser", which would
  // satisfy a search of the whole page without proving anything about the theme.
  await page.goto("chrome://settings/appearance");
  await page.waitForTimeout(1500);
  const themeRow = await page.evaluate(() => {
    const all = (n, acc = []) => { for (const el of n.querySelectorAll("*")) { acc.push(el); if (el.shadowRoot) all(el.shadowRoot, acc); } return acc; };
    const row = all(document).find((el) => el.id === "themeRow");
    return row ? (row.shadowRoot ?? row).textContent.replace(/\s+/g, " ").trim() : "";
  });
  check("the Enki Browser theme is active", /Enki Browser/.test(themeRow), themeRow || "theme row not found");

  const winInfo = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$c = Join-Path '${app}' 'chromium\\chrome.exe'; ` +
    `(Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $c -and $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle; ` +
    `(Get-Item $c).VersionInfo.FileDescription`]).toString().trim().split(/\r?\n/);
  check("the window title ends in Enki Browser", / - Enki Browser$/.test(winInfo[0] ?? ""), winInfo[0] ?? "no window");
  check("chrome.exe describes itself as Enki Browser", winInfo.at(-1) === "Enki Browser", winInfo.at(-1));

  // ---- the assistant itself
  await page.goto(`chrome-extension://${version.enkiExtensionId}/src/sidepanel/index.html`);
  await page.waitForTimeout(1200);
  const panel = await page.evaluate(() => document.body.innerText);
  // With no provider chosen yet, the panel opens straight into setup; that is the first-run view.
  check("the Enki panel renders", /Enki|Settings/.test(panel) && /Model/.test(panel), panel.split("\n").slice(0, 3).join(" | "));

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
