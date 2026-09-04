// End-to-end smoke test: loads dist/ into Chromium, points Enki at the mock LLM, and runs
// an Ask-mode question plus an Act-mode task (read_page -> type -> click with approval).
//
// Prereqs: `npm run build`, `node test/mock-llm.mjs` running, and Playwright available
// (set PLAYWRIGHT_DIR to a folder where `npm i playwright && npx playwright install chromium` ran).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "..", "dist");
const pwDir = process.env.PLAYWRIGHT_DIR ?? path.resolve(here, "..");
const { chromium } = await import(pathToFileURL(path.join(pwDir, "node_modules", "playwright", "index.mjs")).href);

const MOCK = "http://127.0.0.1:8787";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const userDataDir = await mkdtemp(path.join(os.tmpdir(), "enki-e2e-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--window-size=1200,900"],
  viewport: { width: 420, height: 760 },
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  console.log("extension id", extId);

  // The background must be the real service worker (not a mis-bundled content script) and must
  // have registered the action-click behavior.
  await new Promise((r) => setTimeout(r, 500));
  const behavior = await sw.evaluate(() => chrome.sidePanel.getPanelBehavior());
  check("background: icon click opens the side panel", behavior?.openPanelOnActionClick === true, JSON.stringify(behavior));

  // Panel opened as a tab; it will control a separate window via ?window=<id>.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/src/sidepanel/index.html`);

  await panel.evaluate(
    (mock) =>
      chrome.storage.local.set({
        "enki:settings": {
          preset: "custom",
          apiKey: "test",
          baseUrl: `${mock}/v1`,
          model: "mock-echo",
          autoApprove: false,
          attachScreenshot: true,
          maxSteps: 10,
          customInstructions: "",
        },
        "enki:mode": "ask",
      }),
    MOCK,
  );

  const targetWindowId = await panel.evaluate(async (mock) => {
    const w = await chrome.windows.create({ url: `${mock}/page`, width: 1000, height: 800, focused: true });
    return w.id;
  }, MOCK);
  await panel.goto(`chrome-extension://${extId}/src/sidepanel/index.html?window=${targetWindowId}`);
  await panel.waitForSelector("textarea", { timeout: 10000 });
  await panel.waitForTimeout(800);

  // ---- Ask mode: echo model proves page context + screenshot reach the provider ----
  await panel.fill("textarea", "What is this page?");
  await panel.press("textarea", "Enter");
  await panel.waitForFunction(() => document.body.innerText.includes("Echo:"), null, { timeout: 20000 });
  const echo = await panel.evaluate(() => document.body.innerText);
  check("ask: page context sent", /Current tab\] Enki test page/.test(echo), echo.match(/Echo:.*$/m)?.[0]);
  check("ask: screenshot attached", /image=true/.test(echo));
  check("ask: user screenshot thumbnail rendered", await panel.locator("img[alt='Screenshot attached']").count() === 1);

  // ---- Act mode: scripted agent run ----
  await panel.evaluate(async () => {
    const s = (await chrome.storage.local.get("enki:settings"))["enki:settings"];
    await chrome.storage.local.set({ "enki:settings": { ...s, model: "mock-agent" }, "enki:mode": "act" });
  });
  await panel.reload();
  await panel.waitForSelector("textarea", { timeout: 10000 });
  await panel.click("button[title*='Act']");
  await panel.fill("textarea", "Search for hello and buy it");
  await panel.press("textarea", "Enter");

  // Approval card should appear for "Buy now".
  await panel.waitForSelector("text=Allow", { timeout: 30000 });
  const cardText = await panel.evaluate(() => document.body.innerText);
  check("act: approval requested for Buy now", /Click "Buy now"/.test(cardText));
  await panel.click("button:has-text('Allow')");

  await panel.waitForFunction(() => document.body.innerText.includes("Done."), null, { timeout: 30000 });
  const finalText = await panel.evaluate(() => document.body.innerText);
  check("act: read_page ran", /Read page \(interactive\)/.test(finalText));
  check("act: type ran", /Type "hello enki"/.test(finalText));

  const tabState = await panel.evaluate(async (wid) => {
    const [t] = await chrome.tabs.query({ active: true, windowId: wid });
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: t.id },
      func: () => ({ title: document.title, value: document.getElementById("q").value, echo: document.getElementById("echo").textContent }),
    });
    return r.result;
  }, targetWindowId);
  check("act: text typed via CDP fired input events", tabState.echo === "typed: hello enki", JSON.stringify(tabState));
  check("act: click reached the page", tabState.title === "BOUGHT:hello enki", tabState.title);

  // Playwright keeps its own CDP client attached, so `getTargets().attached` is not usable here.
  // The extension's own attachment is gone when detach() reports "not attached".
  await panel.waitForTimeout(600);
  const debuggerDetached = await panel.evaluate(async (wid) => {
    const [t] = await chrome.tabs.query({ active: true, windowId: wid });
    try {
      await chrome.debugger.detach({ tabId: t.id });
      return "was still attached";
    } catch (e) {
      return /not attached/i.test(String(e?.message ?? e)) ? "ok" : String(e?.message ?? e);
    }
  }, targetWindowId);
  check("act: debugger detached after turn", debuggerDetached === "ok", debuggerDetached);

  await mkdir(path.join(here, ".out"), { recursive: true });
  await panel.screenshot({ path: path.join(here, ".out", "panel.png"), fullPage: true });
} catch (e) {
  check("run", false, e instanceof Error ? e.stack ?? e.message : String(e));
} finally {
  await context.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
