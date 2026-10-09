// Ctrl+Shift+E opens the Enki side panel. Presses the real key through X (xdotool) because
// Playwright's and CDP's synthetic key events never reach Chromium's extension command handling.
// In 0.8.3 the command fired but sidePanel.open was rejected (the user gesture was lost to an
// await), and a popup window opened instead of the panel.
//
// Prereqs: `npm run build`, `npx playwright install chromium`, xdotool, and an X display without a
// window manager is fine: `xvfb-run -a npm run test:shortcut`. No mock model needed.
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
const xdotool = (...args) => execFileSync("xdotool", args, { encoding: "utf8" }).trim();
try { xdotool("version"); } catch {
  console.error("xdotool is required (apt-get install xdotool)");
  process.exit(1);
}

const profile = await mkdtemp(path.join(os.tmpdir(), "enki-shortcut-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--window-size=1100,800", "--window-position=40,40"],
  viewport: null,
});
let checks = 0;
const check = (name, value, detail = "") => { assert.ok(value, `${name}${detail ? ` — ${detail}` : ""}`); console.log("PASS", name); checks++; };
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));
  // Keep what the worker reports, so a rejected sidePanel.open shows up in the failure.
  await sw.evaluate(() => {
    globalThis.__enkiLog = [];
    const warn = console.warn.bind(console);
    console.warn = (...a) => { globalThis.__enkiLog.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(" ")); warn(...a); };
  });

  // A fresh profile loaded with --load-extension (how Enki Browser's launcher loads Enki) must get
  // the suggested key registered, or the shortcut cannot work at all.
  const commands = await sw.evaluate(() => chrome.commands.getAll());
  const open = commands.find((c) => c.name === "open-panel");
  check("open-panel is registered as Ctrl+Shift+E on a fresh profile", open?.shortcut === "Ctrl+Shift+E", JSON.stringify(open));

  const page = await context.newPage();
  await page.goto("about:blank");
  await page.bringToFront();
  await page.waitForTimeout(500);
  const panels = () => sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })).length);
  check("no side panel before the shortcut", (await panels()) === 0);

  // The browser window is the visible one titled after its tab; Chromium also keeps a 10x10 helper.
  const win = xdotool("search", "--onlyvisible", "--name", "about:blank").split(/\s+/)[0];
  assert.ok(win, "browser window not found on the X display");
  xdotool("windowfocus", "--sync", win); // no window manager under xvfb, so focus rather than activate
  xdotool("key", "--clearmodifiers", "ctrl+shift+e");

  let count = 0;
  for (let i = 0; i < 20 && !count; i++) { await page.waitForTimeout(200); count = await panels(); }
  const log = await sw.evaluate(() => globalThis.__enkiLog);
  const popups = await sw.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ["popup"] })).length);
  check("Ctrl+Shift+E opens the side panel", count === 1, `side panels: ${count}; worker: ${JSON.stringify(log)}`);
  check("no popup window fallback", popups === 0, `popups: ${popups}`);
  check("sidePanel.open was not rejected", !log.some((l) => /sidePanel\.open failed/.test(l)), JSON.stringify(log));
  console.log(`${checks}/${checks} checks passed`);
} finally {
  await context.close();
}
