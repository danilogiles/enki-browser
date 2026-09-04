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

  const configure = async (model, requestTimeoutSec = 60, mode = "ask") =>
    panel.evaluate(
      ({ mock, model, requestTimeoutSec, mode }) =>
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
            devMode: true,
            customInstructions: "",
          },
          "enki:mode": mode,
        }),
      { mock: MOCK, model, requestTimeoutSec, mode },
    );

  await configure("mock-echo");
  const wid = await panel.evaluate(
    async (mock) => (await chrome.windows.create({ url: `${mock}/page`, width: 900, height: 700 })).id,
  );
  const panelUrl = `chrome-extension://${extId}/src/sidepanel/index.html?window=${wid}`;

  /** Sends one message into the conversation already on screen. */
  const send = async (text, timeout = 60000) => {
    await panel.fill("textarea", text);
    await panel.press("textarea", "Enter");
    // A fast mock can finish between polls, so anchor on the sent message appearing rather
    // than on catching the Stop button while it exists.
    await panel.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: 20000 });
    await panel.waitForFunction(() => !document.querySelector("button[title='Stop']"), null, { timeout });
    await panel.waitForTimeout(400);
    return panel.evaluate(() => document.body.innerText);
  };

  /** Starts a fresh conversation with the given model, then sends one message. */
  const ask = async (model, text, { timeout = 60000, requestTimeoutSec = 60, mode = "ask" } = {}) => {
    await configure(model, requestTimeoutSec, mode);
    await panel.goto(panelUrl);
    await panel.waitForSelector("textarea", { timeout: 10000 });
    await panel.waitForTimeout(600);
    return send(text, timeout);
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

  // 3. A model that reports success without calling a tool must be caught, not believed.
  const liar = await ask("mock-liar", "open my drive", { mode: "act" });
  const movedTo = await panel.evaluate(
    async (w) => (await chrome.tabs.query({ active: true, windowId: w }))[0]?.url,
    wid,
  );
  check(
    "a claimed-but-unperformed action is retracted and retried",
    !/opened your Google Drive/i.test(liar) && /moved=1/.test(movedTo ?? ""),
    `tab=${movedTo} | ${liar.split("\n").filter(Boolean).slice(-3).join(" | ")}`,
  );

  // 4. Repeated page reads must not pile up: only the newest observations stay in context.
  await panel.evaluate(
    async ({ wid, mock }) => {
      const [t] = await chrome.tabs.query({ active: true, windowId: wid });
      await chrome.tabs.update(t.id, { url: `${mock}/heavy` });
      await new Promise((r) => setTimeout(r, 2500));
    },
    { wid, mock: MOCK },
  );
  const sizes = [];
  panel.on("console", (m) => {
    const s = /contextChars: (\d+)/.exec(m.text());
    const f = /freedChars: (\d+)/.exec(m.text());
    if (s) sizes.push({ chars: Number(s[1]), freed: f ? Number(f[1]) : 0 });
  });
  // One conversation, three messages — reloading the panel would start over.
  await ask("mock-reader", "read the page 0", { mode: "act" });
  await send("read the page 1");
  await send("read the page 2");
  // Each read of /heavy is ~14k chars. Three of them unpruned would push the context past 40k;
  // compaction should collapse the superseded ones and hold it well below that.
  const peak = Math.max(...sizes.map((s) => s.chars), 0);
  const freed = Math.max(...sizes.map((s) => s.freed), 0);
  check(
    "repeated page reads are compacted instead of accumulating",
    freed > 8000 && peak < 40000,
    `peak=${peak} freedInOneStep=${freed} (3 unpruned snapshots would exceed 40000)`,
  );

  // 5. A wedged gateway must fail with a message instead of spinning forever. The response
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
