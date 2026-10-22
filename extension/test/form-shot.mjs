import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp } from "node:fs/promises";
import { chromium } from "playwright";
const dist = path.resolve("dist");
const outDir = "/workspace/enki-0811-shots";
await mkdir(outDir, { recursive: true });
const context = await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(), "enki-form-")), {
  headless: false, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`], viewport: { width: 420, height: 850 },
});
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const id = new URL(sw.url()).host;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html`);
  const target = await panel.evaluate(async () => {
    const w = await chrome.windows.create({ url: "http://127.0.0.1:8787/form", width: 900, height: 700 });
    return { wid: w.id, tab: w.tabs[0].id };
  });
  await panel.evaluate(async () => {
    await chrome.storage.local.set({ "enki:settings": { preset: "custom", baseUrl: "http://127.0.0.1:8787/v1", apiKey: "test",
      model: "mock-form-filled", vision: false, attachScreenshot: false, autoApprove: false, maxSteps: 12, requestTimeoutSec: 8,
      theme: "dark", customInstructions: "", saveConversations: true, acceptedTerms: "1" }, "enki:mode": "act" });
  });
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html?window=${target.wid}`);
  await panel.waitForSelector("textarea");
  await panel.click("button[title='More']"); await panel.selectOption("#controlled-tab", String(target.tab)); await panel.keyboard.press("Escape");
  await panel.fill("textarea", "fill and submit"); await panel.press("textarea", "Enter");
  await panel.waitForSelector("button:has-text('Allow')", { timeout: 60000 });
  const body = await panel.textContent("body");
  console.log("HAS_NAME", body.includes("Ada Lovelace"), "HAS_CO", body.includes("Example Labs"), "ALLOW_ANYWAY", body.includes("Allow anyway"));
  await panel.locator("[role=alertdialog]").first().screenshot({ path: path.join(outDir, "confirm-normal-dark.png") });
  // page-requested shot
  await panel.click("button:has-text('Cancel')");
  await panel.waitForFunction(() => !document.querySelector("button[title='Stop']"));
  await panel.evaluate(async () => {
    const s = (await chrome.storage.local.get("enki:settings"))["enki:settings"];
    await chrome.storage.local.set({ "enki:settings": { ...s, model: "mock-inject-submit" }, "enki:mode": "act" });
  });
  const inj = await panel.evaluate(async () => {
    const w = await chrome.windows.create({ url: "http://127.0.0.1:8787/inject", width: 900, height: 700 });
    return { wid: w.id, tab: w.tabs[0].id };
  });
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html?window=${inj.wid}`);
  await panel.waitForSelector("textarea");
  await panel.click("button[title='More']"); await panel.click("button[title='New chat']");
  await panel.click("button[title='More']"); await panel.selectOption("#controlled-tab", String(inj.tab)); await panel.keyboard.press("Escape");
  await panel.fill("textarea", "what does this page say"); await panel.press("textarea", "Enter");
  await panel.waitForSelector("button:has-text('Allow anyway')", { timeout: 30000 });
  await panel.locator("[role=alertdialog]").first().screenshot({ path: path.join(outDir, "confirm-page-requested-dark.png") });
  // unknown-destination shot (image button in a search form)
  await panel.click("button:has-text('Cancel')");
  await panel.waitForFunction(() => !document.querySelector("button[title='Stop']"));
  await panel.evaluate(async () => {
    const s = (await chrome.storage.local.get("enki:settings"))["enki:settings"];
    await chrome.storage.local.set({ "enki:settings": { ...s, model: "mock-image-search", autoApprove: false }, "enki:mode": "act" });
  });
  const img = await panel.evaluate(async () => {
    const w = await chrome.windows.create({ url: "http://127.0.0.1:8787/image-search", width: 900, height: 700 });
    return { wid: w.id, tab: w.tabs[0].id };
  });
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html?window=${img.wid}`);
  await panel.waitForSelector("textarea");
  await panel.click("button[title='More']"); await panel.click("button[title='New chat']");
  await panel.click("button[title='More']"); await panel.selectOption("#controlled-tab", String(img.tab)); await panel.keyboard.press("Escape");
  await panel.fill("textarea", "search for cats"); await panel.press("textarea", "Enter");
  await panel.waitForSelector("button:has-text('Allow')", { timeout: 60000 });
  const unk = await panel.textContent("[role=alertdialog]");
  console.log("UNKNOWN", (unk || "").includes("Unknown destination"));
  await panel.locator("[role=alertdialog]").first().screenshot({ path: path.join(outDir, "confirm-unknown-destination-dark.png") });
  console.log("SHOTS OK");
} catch (e) {
  console.error("FAIL", e.message);
  process.exitCode = 1;
} finally { await context.close(); }
