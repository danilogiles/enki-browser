// Live check against a real OmniRoute on localhost:20128 — not part of CI, it depends on
// whichever free upstreams answer today. Loads dist/, saves OmniRoute settings the way an
// existing user has them (no textTools key, so the preset default applies), and runs one Act task.
//
// Usage: npm run build && node test/live-omniroute.mjs [model]
import path from "node:path";
import os from "node:os";
import { mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
const model = process.argv[2] ?? "cfp/moonshotai/kimi-k2.6";
const task = process.argv[3] ?? "Qual é o título principal (h1) desta página? Use as ferramentas para ler a página.";
const context = await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(), "enki-live-")), {
  headless: false, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`], viewport: { width: 440, height: 900 },
});
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const id = new URL(sw.url()).host;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html`);
  const target = await panel.evaluate(async () => {
    const w = await chrome.windows.create({ url: "https://example.com/", width: 900, height: 700 });
    return w.id;
  });
  await panel.evaluate(async (model) => {
    await chrome.storage.local.set({ "enki:settings": { preset: "omniroute", baseUrl: "http://localhost:20128/v1", apiKey: "", model,
      vision: false, attachScreenshot: false, autoApprove: false, maxSteps: 8, requestTimeoutSec: 90, devMode: true,
      theme: "dark", customInstructions: "", saveConversations: false }, "enki:mode": "act" });
  }, model);
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html?window=${target}`);
  await panel.waitForTimeout(1500);
  await panel.fill("textarea", task);
  await panel.press("textarea", "Enter");
  await panel.waitForFunction(() => !!document.querySelector("button[title='Stop']"), null, { timeout: 10000 }).catch(() => {});
  await panel.waitForFunction(() => !document.querySelector("button[title='Stop']"), null, { timeout: 240000 });
  await panel.waitForTimeout(500);
  const out = path.resolve(here, ".out/live-omniroute.png");
  await panel.screenshot({ path: out, fullPage: true });
  console.log(await panel.evaluate(() => document.body.innerText));
  console.log("screenshot:", out);
} finally {
  await context.close();
}
