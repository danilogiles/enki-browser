// "Check for updates" in the Shields button's right-click menu. Loads shield/ from this checkout
// into Chromium with a throwaway profile and checks, in Shield's own worker:
//   - the item exists, for the toolbar button's menu only (contexts ["action"]);
//   - making it again (a worker restart, onInstalled after onStartup) is no duplicate-id error;
//   - clicking it opens Shields' settings at the update check (options.html#check-updates).
// A toolbar button's context menu cannot be opened by automation, so the click runs the handler
// the menu calls, from the worker.
//
//   xvfb-run -a node test/shield-menu.mjs        Playwright's Chromium (npx playwright install chromium)
//   ENKI_LINUX_DIR=… xvfb-run -a node test/…      an installed Enki Browser's own Chromium
//   ENKI_CHROMIUM=/path/to/chrome …               any Chromium that takes --load-extension
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shieldDir = path.resolve(process.env.ENKI_SHIELD_DIR ?? path.join(root, "shield"));
const enkiChrome = process.env.ENKI_LINUX_DIR && path.join(process.env.ENKI_LINUX_DIR, "chromium", "chrome");
const executablePath = process.env.ENKI_CHROMIUM ?? (enkiChrome && existsSync(enkiChrome) ? enkiChrome : chromium.executablePath());

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
async function until(fn, ms) {
  const end = Date.now() + ms;
  let last;
  do { last = await fn().catch(() => undefined); if (last) return last; await new Promise((r) => setTimeout(r, 250)); } while (Date.now() < end);
  return last;
}

const userData = mkdtempSync(path.join(os.tmpdir(), "enki-shield-menu-"));
const ctx = await chromium.launchPersistentContext(userData, {
  executablePath,
  headless: false,
  args: [`--disable-extensions-except=${shieldDir}`, `--load-extension=${shieldDir}`, "--no-first-run", "--no-default-browser-check"],
});
try {
  const sw = await until(async () => ctx.serviceWorkers().find((w) => /\/background(-[0-9a-f]+)?\.js$/.test(new URL(w.url()).pathname)), 20000);
  if (!sw) throw new Error("Shield's worker did not start");
  const id = new URL(sw.url()).host;
  await until(() => sw.evaluate(() => !!globalThis.enkiShieldMenu), 10000);

  const item = await sw.evaluate(() => globalThis.enkiShieldMenu?.item);
  check("the menu item is \"Check for updates\" on the Shields button only", item?.title === "Check for updates" && JSON.stringify(item?.contexts) === '["action"]', JSON.stringify(item));
  // contextMenus has no "list": update() succeeds only for an item that exists.
  const exists = () => sw.evaluate((itemId) => new Promise((r) => chrome.contextMenus.update(itemId, {}, () => r(chrome.runtime.lastError?.message ?? "ok"))), item.id);
  check("the item is registered", (await until(async () => ((await exists()) === "ok" ? "ok" : null), 5000)) === "ok", await exists());
  const remade = await sw.evaluate(async () => {
    const errors = [];
    const warn = console.warn;
    console.warn = (...a) => { errors.push(a.join(" ")); warn(...a); };
    await Promise.all([globalThis.enkiShieldMenu.make(), globalThis.enkiShieldMenu.make()]);
    await globalThis.enkiShieldMenu.make();
    console.warn = warn;
    return errors;
  });
  check("making it again is no duplicate-id error", remade.length === 0, JSON.stringify(remade));
  check("…and it is still there", (await exists()) === "ok");

  const before = ctx.pages().length;
  await sw.evaluate(() => globalThis.enkiShieldMenu.open());
  const want = `chrome-extension://${id}/options.html#check-updates`;
  const opened = await until(async () => ctx.pages().find((p) => p.url() === want), 10000);
  check("clicking it opens Shields' settings at #check-updates", !!opened, `${ctx.pages().map((p) => p.url()).join(", ")} (had ${before} tabs)`);
  if (opened) {
    await opened.waitForLoadState("domcontentloaded");
    const button = await opened.evaluate(() => !!document.getElementById("check-updates"));
    check("the settings page has its Check for updates button", button);
  }
} catch (e) {
  check("shield menu", false, e.stack ?? String(e));
} finally {
  await ctx.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
