// Burn all data asks first, with Cancel as the default, in Shields' settings and in the Shields
// panel: Cancel, Enter and Esc burn nothing, and only Burn burns. And Enki's Act mode cannot press
// it: the browser refuses an extension with Enki's permissions (debugger, scripting, every site)
// on another extension's pages (Enki's own executor refuses first: extension/test/unit.cjs).
// Loads shield/ from this checkout into Chromium with a throwaway profile and uses it the way a
// person would: clicks, and keys on whatever has the focus.
//
//   xvfb-run -a node test/burn-confirm.mjs        Playwright's Chromium (npx playwright install chromium)
//   ENKI_LINUX_DIR=… xvfb-run -a node test/…      an installed Enki Browser's own Chromium
//   ENKI_CHROMIUM=/path/to/chrome …               any Chromium that takes --load-extension
//   ENKI_SHIELD_DIR=/other/shield …               another copy of the Shield (to see an old one fail)
//
// Extensions only load in headed Chromium: on a machine without a display, run it under xvfb-run.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shieldDir = path.resolve(process.env.ENKI_SHIELD_DIR ?? path.join(root, "shield"));
const enkiChrome = process.env.ENKI_LINUX_DIR && path.join(process.env.ENKI_LINUX_DIR, "chromium", "chrome");
const executablePath = process.env.ENKI_CHROMIUM ?? (enkiChrome && existsSync(enkiChrome) ? enkiChrome : chromium.executablePath());

// What the question says (Ink's mock, docs: 0.8.4-burn-confirm). It has to match burn.js:
// browsingData deletes websites' data only; extensions' storage stays.
const SETTINGS_COPY = {
  title: "Burn everything now?",
  sub: "Every tab closes and this browsing data is deleted. This cannot be undone.",
  deletes: ["Every open tab (closed)", "History", "Cookies and site data", "Cache", "Download history", "Autofill (saved addresses & cards)"],
  kept: ["Passwords", "Bookmarks", "Enki chats, settings, and API keys", "Shields settings"],
  hint: "Enter or Esc cancels",
};
const PANEL_COPY = {
  title: "🔥 Burn everything now?",
  sub: "Every tab closes. This cannot be undone.",
  deletes: "History, cookies and site data, cache, download history, autofill (saved addresses & cards)",
  kept: "Passwords, bookmarks, and Enki chats, settings, and API keys. Shields settings too.",
  hint: "Enter cancels",
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
async function until(fn, ms) {
  const end = Date.now() + ms;
  let last;
  do {
    last = await fn().catch(() => undefined);
    if (last) return last;
    await new Promise((r) => setTimeout(r, 250));
  } while (Date.now() < end);
  return last;
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// A site with something to lose: a cookie and local storage.
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.setHeader("set-cookie", "burn_test=1; Max-Age=3600; Path=/");
  res.end("<!doctype html><title>Burn test site</title><p>burn test</p>");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const site = `http://127.0.0.1:${server.address().port}/`;

// Stands in for Enki's assistant: the permissions Act uses to reach pages, and nothing else.
const userData = mkdtempSync(path.join(os.tmpdir(), "enki-burn-confirm-"));
const actor = path.join(userData, "..", `${path.basename(userData)}-actor`);
mkdirSync(actor, { recursive: true });
writeFileSync(path.join(actor, "manifest.json"), JSON.stringify({
  manifest_version: 3, name: "Act stand-in", version: "1.0",
  background: { service_worker: "sw.js" },
  permissions: ["tabs", "scripting", "debugger", "activeTab"], host_permissions: ["<all_urls>"],
}));
writeFileSync(path.join(actor, "sw.js"), "self.ready = true;\n");

const ctx = await chromium.launchPersistentContext(userData, {
  executablePath,
  headless: false,
  args: [`--disable-extensions-except=${shieldDir},${actor}`, `--load-extension=${shieldDir},${actor}`, "--no-first-run", "--no-default-browser-check"],
});
let exitCode = 1;
try {
  const workers = await until(async () => {
    const w = ctx.serviceWorkers();
    const shield = w.find((x) => x.url().endsWith("/background.js"));
    const act = w.find((x) => x.url().endsWith("/sw.js"));
    return shield && act ? { shield, act } : null;
  }, 20000);
  if (!workers) throw new Error("the extensions did not start");
  const id = new URL(workers.shield.url()).host;
  console.log(`Chromium ${ctx.browser()?.version() ?? ""} · ${executablePath} · Shield ${id} from ${shieldDir}`);

  const sitePage = await ctx.newPage();
  await sitePage.goto(site);
  await sitePage.evaluate(() => localStorage.setItem("burn-test", "1"));
  const siteData = () => sitePage.evaluate(() => ({ storage: localStorage.getItem("burn-test"), cookie: document.cookie }));
  const siteIntact = async () => { const d = await siteData(); return !sitePage.isClosed() && d.storage === "1" && /burn_test=1/.test(d.cookie); };

  // Records any window.confirm() (answering OK, as Enter or a quick click did before) and every
  // message the page sends, so a burn that skips the in-page question shows up.
  const spy = (page) => page.evaluate(() => {
    window.__confirms = [];
    window.confirm = (text) => { window.__confirms.push(String(text)); return true; };
    window.__sent = [];
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (...args) => { window.__sent.push(args.find((a) => a && typeof a === "object")?.type ?? null); return send(...args); };
  });
  const state = (page) => page.evaluate(() => {
    const box = document.getElementById("burn-confirm");
    const t = (sel) => [...box.querySelectorAll(sel)].map((el) => el.textContent.replace(/\s+/g, " ").trim());
    return {
      shown: !box.hidden && getComputedStyle(box).display !== "none",
      focused: document.activeElement?.id ?? null,
      title: document.getElementById("burn-title").textContent.trim(),
      sub: document.getElementById("burn-text").textContent.replace(/\s+/g, " ").trim(),
      deletes: t(".del li").length ? t(".del li").map((s) => s.replace(/^✕/, "")) : t(".del p")[0],
      kept: t(".keep li").length ? t(".keep li").map((s) => s.replace(/^✓/, "")) : t(".keep p")[0],
      hint: t(".hint, .confirm-hint")[0],
      go: document.getElementById("burn-go").textContent,
      checkbox: !!box.querySelector("input[type=checkbox]"),
      confirms: window.__confirms.length,
      burns: window.__sent.filter((x) => x === "shields:burn" || x === "shields:shred").length,
    };
  });
  const tabsOpen = async () => ctx.pages().filter((p) => !p.isClosed()).length;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---- Shields settings: Burn everything now
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForFunction(() => document.documentElement.dataset.updates === "ready", null, { timeout: 20000 });
  await spy(options);

  let s = await state(options);
  check("settings: the question is hidden until Burn is pressed", !s.shown);

  await options.click("#burn-now");
  await pause(300);
  s = await state(options);
  check("settings: Burn all data asks in the page, not with confirm()", s.shown && s.confirms === 0, JSON.stringify({ shown: s.shown, confirms: s.confirms }));
  check("settings: Cancel has the focus, not Burn", s.focused === "burn-cancel", `focused: ${s.focused}`);
  check("settings: the question says exactly what goes and what stays",
    s.title === SETTINGS_COPY.title && s.sub === SETTINGS_COPY.sub && same(s.deletes, SETTINGS_COPY.deletes) && same(s.kept, SETTINGS_COPY.kept) && s.hint === SETTINGS_COPY.hint,
    JSON.stringify({ title: s.title, sub: s.sub, deletes: s.deletes, kept: s.kept, hint: s.hint }));
  check("settings: no checkbox in this version", !s.checkbox);
  const inert = await options.evaluate(() => ({ behind: [...document.body.children].filter((el) => el.id !== "burn-confirm" && el.tagName !== "SCRIPT").every((el) => el.inert), modal: !document.getElementById("burn-confirm").inert }));
  check("settings: the page behind the question cannot be reached", inert.behind && inert.modal, JSON.stringify(inert));
  check("settings: nothing burns while it asks", s.burns === 0 && await siteIntact());

  await options.keyboard.press("Enter");
  await pause(400);
  s = await state(options);
  check("settings: Enter cancels (no burn), focus back on Burn all data", !s.shown && s.focused === "burn-now" && s.burns === 0 && s.confirms === 0 && await siteIntact(), `focused: ${s.focused}`);

  await options.click("#burn-now");
  await pause(200);
  await options.keyboard.press("Escape");
  await pause(400);
  s = await state(options);
  check("settings: Esc cancels (no burn)", !s.shown && s.burns === 0 && await siteIntact());
  check("settings: the page is usable again after cancelling", await options.evaluate(() => [...document.body.children].every((el) => !el.inert)));

  await options.click("#burn-now");
  await pause(200);
  await options.click("#burn-cancel");
  await pause(400);
  s = await state(options);
  check("settings: Cancel burns nothing", !s.shown && s.burns === 0 && await siteIntact() && (await tabsOpen()) >= 2);

  // ---- The Shields panel (opened as a page for the site's tab, as verify.mjs does)
  const siteTab = await options.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, `${site}*`);
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/popup.html?tab=${siteTab}`);
  await panel.waitForFunction(() => document.documentElement.dataset.ready === "true", null, { timeout: 20000 });
  await spy(panel);
  await panel.click("#burn");
  await pause(300);
  let p = await state(panel);
  check("panel: Burn asks first, with Cancel focused", p.shown && p.go === "Burn" && p.focused === "burn-cancel", `focused: ${p.focused}`);
  check("panel: the question says exactly what goes and what stays",
    p.title === PANEL_COPY.title && p.sub === PANEL_COPY.sub && p.deletes === PANEL_COPY.deletes && p.kept === PANEL_COPY.kept && p.hint === PANEL_COPY.hint && !p.checkbox,
    JSON.stringify({ title: p.title, sub: p.sub, deletes: p.deletes, kept: p.kept, hint: p.hint }));
  await panel.keyboard.press("Enter");
  await pause(300);
  p = await state(panel);
  check("panel: Enter cancels (no burn), focus back on Burn all data", !p.shown && p.focused === "burn" && p.burns === 0 && await siteIntact(), `focused: ${p.focused}`);
  await panel.click("#burn");
  await pause(200);
  await panel.keyboard.press("Escape");
  await pause(300);
  p = await state(panel);
  check("panel: Esc cancels (no burn)", !p.shown && p.burns === 0 && await siteIntact());
  await panel.click("#shred");
  await pause(300);
  p = await state(panel);
  const shredLists = await panel.evaluate(() => document.getElementById("burn-lists").hidden && document.getElementById("burn-title").hidden);
  check("panel: Shred asks first, with Cancel focused (and without Burn's lists)", p.shown && p.go === "Shred" && p.focused === "burn-cancel" && shredLists, `focused: ${p.focused} · ${p.sub}`);
  await panel.click("#burn-cancel");
  await pause(300);
  p = await state(panel);
  check("panel: Cancel shreds nothing", !p.shown && p.burns === 0 && await siteIntact());

  // ---- Act cannot press it: with the question open in the settings and the panel, an extension
  // with Act's permissions can neither drive the page (debugger) nor run code in it (scripting).
  await options.click("#burn-now");
  await panel.click("#burn");
  await pause(300);
  const panelTab = await options.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, `chrome-extension://${id}/popup.html*`);
  const optionsTab = await options.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, `chrome-extension://${id}/options.html`);
  const tries = await workers.act.evaluate(async (tabs) => {
    const out = {};
    for (const [name, tabId] of Object.entries(tabs)) {
      const tab = await chrome.tabs.get(tabId);
      let attached = "attached";
      try {
        await chrome.debugger.attach({ tabId }, "1.3");
        // Were it allowed: Enter on the focused button, then a click where Burn would be.
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await chrome.debugger.detach({ tabId }).catch(() => {});
      } catch (e) { attached = `refused: ${e?.message ?? e}`; }
      let scripted = "ran";
      try {
        await chrome.scripting.executeScript({ target: { tabId }, func: () => document.getElementById("burn-go")?.click() });
      } catch (e) { scripted = `refused: ${e?.message ?? e}`; }
      out[name] = { url: tab.url, attached, scripted };
    }
    return out;
  }, { settings: optionsTab, panel: panelTab });
  await pause(1500);
  const actRefused = Object.values(tries).every((t) => /^refused/.test(t.attached) && /^refused/.test(t.scripted));
  check("Act's permissions cannot drive or script Shields' settings or panel", actRefused, JSON.stringify(tries));
  s = await state(options);
  check("…and nothing burned", s.burns === 0 && await siteIntact() && !options.isClosed());
  await panel.click("#burn-cancel");
  await panel.close();

  // ---- Settings: Burn, confirmed, burns.
  await options.click("#burn-go");
  // Burn closes every tab (this page too) and leaves one new tab, then deletes the data.
  const allTabs = () => workers.act.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.pendingUrl || t.url));
  const closed = await until(async () => sitePage.isClosed() && options.isClosed() && (await allTabs()).length === 1, 20000);
  const leftTabs = await allTabs();
  check("settings: Burn, confirmed, closes every tab but one new tab", !!closed && /^chrome:\/\/(newtab|new-tab-page)/.test(leftTabs[0] ?? ""), JSON.stringify(leftTabs));
  await pause(1500);
  const after = ctx.pages().find((x) => !x.isClosed()) ?? await ctx.newPage();
  // A fresh load sets the cookie again, so read what is left from the request's Cookie header;
  // local storage is untouched by loading.
  let sentCookie = null;
  server.once("request", (req) => { sentCookie = req.headers.cookie ?? ""; });
  await after.goto(site);
  const burned = await after.evaluate(() => localStorage.getItem("burn-test"));
  check("settings: Burn, confirmed, deletes the site's cookies and storage", burned === null && sentCookie === "", JSON.stringify({ storage: burned, cookieSent: sentCookie }));
  exitCode = results.every((r) => r.ok) ? 0 : 1;
} catch (e) {
  console.error(e);
  check("the test ran to the end", false, String(e?.message ?? e).split("\n")[0]);
} finally {
  await ctx.close().catch(() => {});
  server.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(actor, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : exitCode);
