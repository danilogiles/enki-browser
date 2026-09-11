// Prereqs: `npm run build`, `node test/mock-llm.mjs` running, `npx playwright install chromium`.
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
const context = await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(), "enki-quality-")), {
  headless: false, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`], viewport: { width: 420, height: 850 },
});
let checks = 0;
const check = (name, value) => { assert.ok(value, name); console.log("PASS", name); checks++; };
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const id = new URL(sw.url()).host;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html`);
  const target = await panel.evaluate(async () => {
    const w = await chrome.windows.create({ url: "http://127.0.0.1:8787/page", width: 900, height: 700 });
    return { wid: w.id, tab: w.tabs[0].id };
  });
  const url = `chrome-extension://${id}/src/sidepanel/index.html?window=${target.wid}`;
  const configure = async (model, mode = "act", extra = {}) => {
    await panel.evaluate(async ({ model, mode, extra }) => {
      await chrome.storage.local.set({ "enki:settings": { preset: "custom", baseUrl: "http://127.0.0.1:8787/v1", apiKey: "test",
        model, vision: false, attachScreenshot: false, autoApprove: false, maxSteps: 10, requestTimeoutSec: 6,
        theme: "dark", customInstructions: "", saveConversations: true, ...extra }, "enki:mode": mode });
    }, { model, mode, extra });
    await panel.waitForTimeout(200);
  };
  const idle = () => panel.waitForFunction(() => !document.querySelector("button[title='Stop']"), null, { timeout: 20000 });
  const send = async (text) => {
    await panel.fill("textarea", text); await panel.press("textarea", "Enter");
    await panel.waitForFunction((text) => document.body.innerText.includes(text), text);
    await idle(); await panel.waitForTimeout(350);
  };
  await configure("mock-echo", "ask");
  await panel.goto(url);
  await panel.waitForSelector("textarea");
  await send("remember this quality test");
  await panel.reload();
  await panel.waitForSelector("textarea");
  check("conversation restored after panel reload", (await panel.textContent("body")).includes("remember this quality test"));
  check("restored conversation does not resume automatically", await panel.locator("button[title='Stop']").count() === 0);
  await panel.click("button:has-text('Continue safely')");
  await panel.waitForTimeout(300); await idle();
  check("Continue explicitly reads the page first", (await panel.textContent("body")).includes("Read page (interactive)"));

  await panel.click("button[title='New chat']");
  await configure("mock-lock");
  await panel.reload(); await panel.waitForSelector("textarea");
  await panel.selectOption("#controlled-tab", String(target.tab));
  await panel.fill("textarea", "test tab lock"); await panel.press("textarea", "Enter");
  await panel.waitForSelector("button[title='Stop']");
  await panel.waitForFunction(() => /Waiting for|Preparing page|Connected|Model responding/.test(document.body.innerText));
  check("live status names the waiting stage", true);
  const other = await panel.evaluate(async (wid) => (await chrome.tabs.create({ windowId: wid, url: "http://127.0.0.1:8787/page?other", active: true })).id, target.wid);
  await idle();
  const values = await panel.evaluate(async (ids) => Promise.all(ids.map(async (tabId) => {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.getElementById("q").value }); return r.result;
  })), [target.tab, other]);
  check("switching active tabs cannot redirect task input", values[0] === "locked target" && values[1] === "");

  await panel.click("button[title='New chat']");
  await configure("mock-failure");
  await send("test repeated failures");
  check("repeated failure guard stops visibly", (await panel.textContent("body")).includes("same action failed three times"));
  check("completion summary reports failures", (await panel.textContent("body")).includes("3 failed"));

  await configure("mock-echo", "ask", { favoriteModels: ["mock-echo", "mock-reader"], askModel: "mock-echo", actModel: "mock-reader" });
  await panel.click("summary:has-text('Quick model switch')");
  await panel.fill("#model-search", "reader");
  await panel.click("button[title='mock-reader']");
  await panel.waitForTimeout(200);
  check("favorite model can be searched and selected", await panel.evaluate(async () => (await chrome.storage.local.get("enki:settings"))["enki:settings"].model) === "mock-reader");
  await panel.click("button:has-text('Ask')"); await panel.waitForTimeout(200);
  check("mode switch chooses preferred model", await panel.evaluate(async () => (await chrome.storage.local.get("enki:settings"))["enki:settings"].model) === "mock-echo");

  await configure("mock-probe", "ask");
  await panel.click("button[title='Settings']");
  await panel.click("button:has-text('Run connection diagnostics')");
  await panel.waitForFunction(() => document.body.innerText.includes("Act tool support: pass"));
  check("diagnostics verify structured tools without browser execution", (await panel.textContent("body")).includes("No browser action executed"));
  await panel.click("button:has-text('Behavior')");
  check("context budget and saving are configurable", await panel.locator("#context-budget").count() === 1 && await panel.getByRole("switch", { name: "Save conversations on this device" }).count() === 1);
  const commands = await panel.evaluate(async () => await chrome.commands.getAll());
  check("all four keyboard commands are registered", ["open-panel", "focus-composer", "new-chat", "stop-task"].every((name) => commands.some((c) => c.name === name)));
  await panel.getByRole("switch", { name: "Save conversations on this device" }).click();
  await panel.click("button:has-text('Save')");
  await panel.waitForTimeout(400);
  check("disabling persistence deletes saved transcript", await panel.evaluate(async () => !(await chrome.storage.local.get("enki:conversation"))["enki:conversation"]));
  await configure("mock-no-headers");
  await panel.fill("textarea", "stop using keyboard"); await panel.press("textarea", "Enter");
  await panel.waitForSelector("button[title='Stop']"); await panel.press("textarea", "Escape"); await idle();
  check("Escape stops a waiting request", await panel.locator("button[title='Stop']").count() === 0);
  await panel.click("button[title='New chat']");
  await configure("mock-agent", "act");
  await panel.reload(); await panel.waitForSelector("textarea");
  await panel.fill("textarea", "test new chat during approval"); await panel.press("textarea", "Enter");
  await panel.waitForSelector("button:has-text('Allow')");
  await panel.click("button[title='New chat']"); await idle();
  check("New chat cancels approval without leaving a stuck task", await panel.locator("button:has-text('Allow')").count() === 0);
  await configure("mock-echo");
  await send("fresh conversation after cancelled approval");
  check("new conversation accepts messages after cancellation", (await panel.textContent("body")).includes("Echo:"));
  await panel.setViewportSize({ width: 320, height: 700 });
  check("sidebar fits at 320px", await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await panel.setViewportSize({ width: 420, height: 850 });
  await mkdir(path.join(here, ".out"), { recursive: true });
  await panel.screenshot({ path: path.join(here, ".out/quality-panel.png"), fullPage: true });
  check("sidebar fits without horizontal overflow", await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log(`${checks}/${checks} checks passed`);
} finally { await context.close(); }
