// Exercises how Enki survives badly-behaved models: a gateway that stalls mid-stream, a model
// that answers only in the reasoning channel, and one that emits inline <think> tags.
//
// Prereqs: `npm run build`, `node test/mock-llm.mjs` running, PLAYWRIGHT_DIR set as for e2e.mjs.
import path from "node:path";
import os from "node:os";
import { mkdtemp } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "..", "dist");
const pwDir = process.env.PLAYWRIGHT_DIR ?? path.resolve(here, "..");
const { chromium } = await import(pathToFileURL(path.join(pwDir, "node_modules", "playwright", "index.mjs")).href);

const MOCK = "http://127.0.0.1:8787";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const context = await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(), "enki-res-")), {
  headless: false,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  viewport: { width: 420, height: 800 },
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/src/sidepanel/index.html`);

  const configure = async (model, requestTimeoutSec = 60) =>
    panel.evaluate(
      ({ mock, model, requestTimeoutSec }) =>
        chrome.storage.local.set({
          "enki:settings": {
            preset: "custom",
            apiKey: "test",
            baseUrl: `${mock}/v1`,
            model,
            theme: "dark",
            autoApprove: false,
            vision: false,
            attachScreenshot: false,
            maxSteps: 5,
            requestTimeoutSec,
            customInstructions: "",
          },
          "enki:mode": "ask",
        }),
      { mock: MOCK, model, requestTimeoutSec },
    );

  await configure("mock-echo");
  const wid = await panel.evaluate(
    async (mock) => (await chrome.windows.create({ url: `${mock}/page`, width: 900, height: 700 })).id,
  );
  const panelUrl = `chrome-extension://${extId}/src/sidepanel/index.html?window=${wid}`;

  const ask = async (model, text, { timeout = 60000, requestTimeoutSec = 60 } = {}) => {
    await configure(model, requestTimeoutSec);
    await panel.goto(panelUrl);
    await panel.waitForSelector("textarea", { timeout: 10000 });
    await panel.waitForTimeout(600);
    await panel.fill("textarea", text);
    await panel.press("textarea", "Enter");
    // A fast mock can finish between polls, so anchor on the sent message appearing rather
    // than on catching the Stop button while it exists.
    await panel.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: 20000 });
    await panel.waitForFunction(() => !document.querySelector("button[title='Stop']"), null, { timeout });
    await panel.waitForTimeout(400);
    return panel.evaluate(() => document.body.innerText);
  };

  // 1. A model that only ever fills the reasoning channel must still show an answer.
  const reasoning = await ask("mock-reasoning-only", "check my visa status");
  check(
    "reasoning-only reply is surfaced as the answer",
    /open Gmail and check the visa status/.test(reasoning) && !/Reasoning/.test(reasoning),
    reasoning.split("\n").filter(Boolean).slice(-3).join(" | "),
  );

  // 2. Inline <think> tags split across chunks must not leak into the answer.
  const think = await ask("mock-think-tags", "what is the answer");
  check(
    "inline <think> tags are routed to reasoning, not the answer",
    /The answer is 42\./.test(think) && !/<\/?think/.test(think) && !/planning here/.test(think),
    think.split("\n").filter(Boolean).slice(-3).join(" | "),
  );

  // 3. A wedged gateway must fail with a message instead of spinning forever. The response
  //    timeout is set to 6s here so the test does not sit through the 180s default.
  const started = Date.now();
  const stalled = await ask("mock-stall", "hello", { timeout: 40000, requestTimeoutSec: 6 });
  const elapsed = Math.round((Date.now() - started) / 1000);
  check(
    "a stalled stream times out instead of hanging",
    /sent nothing for 6s/.test(stalled) && elapsed < 35,
    `${elapsed}s | ${stalled.split("\n").filter(Boolean).slice(-2).join(" | ")}`,
  );
} catch (e) {
  check("run", false, e?.stack ?? String(e));
} finally {
  await context.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
