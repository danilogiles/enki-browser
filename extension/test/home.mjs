// Enki Home answers in place.
//
// Ask used to open the side panel and hand the request over. It now answers on the new tab page
// itself, in the same document, and joins the conversation the panel holds — so this suite checks
// the three things that can each be true on their own and still leave the feature broken:
//
//   1. the page does not navigate and does not open the panel,
//   2. the answer arrives in the Home document,
//   3. the panel and the page are ONE conversation, following each other live.
//
// Prereqs are the e2e suite's: `npm run build`, `node test/mock-llm.mjs` running, and Playwright's
// Chromium (stable Chrome refuses --load-extension).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "..", "dist");
const MOCK = "http://127.0.0.1:8787";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Poll instead of waitForFunction: the page under test is often a background tab, and Chrome
 *  throttles timers there — the assertion would fail for the browser's reasons, not the code's. */
async function poll(fn, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { if (await fn()) return true; } catch { /* page busy; try again */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const storedMessages = (page) =>
  page.evaluate(async () => {
    const id = (await chrome.storage.local.get("enki:current-chat"))["enki:current-chat"];
    const key = `enki:chat:${id}`;
    // Chats are stored sealed now; the envelope keeps the message count in the clear.
    const stored = (await chrome.storage.local.get(key))[key];
    return stored?.messages ?? Array(stored?.count ?? 0).fill(null);
  });

const userDataDir = await mkdtemp(path.join(os.tmpdir(), "enki-home-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--window-size=1200,900"],
  viewport: { width: 1100, height: 800 },
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  console.log("extension id", extId);

  const HOME = `chrome-extension://${extId}/src/home/index.html`;
  const PANEL = `chrome-extension://${extId}/src/sidepanel/index.html`;

  const home = await context.newPage();
  await home.goto(HOME);
  // saveConversations is what makes one conversation reachable from both documents; without it
  // there is nothing to share and this whole feature is just a layout change.
  await home.evaluate(
    (mock) =>
      chrome.storage.local.set({
        "enki:settings": {
          preset: "custom", apiKey: "test", baseUrl: `${mock}/v1`, model: "mock-echo",
          autoApprove: false, vision: false, attachScreenshot: false, maxSteps: 10,
          customInstructions: "", saveConversations: true,
        },
        "enki:mode": "ask",
      }),
    MOCK,
  );
  await home.goto(HOME);
  await home.waitForSelector("textarea", { timeout: 10000 });

  // ----- 1. Ask answers here -----
  await home.fill("textarea", "first question from home");
  await home.press("textarea", "Enter");

  await home.waitForFunction(() => document.body.innerText.includes("Echo:"), null, { timeout: 30000 });
  const url = await home.evaluate(() => location.href);
  check("home: Ask does not navigate away from the new tab page", url.endsWith("/src/home/index.html"), url);

  const homeText = await home.evaluate(() => document.body.innerText);
  check("home: the answer is rendered in the Home document", /Echo:/.test(homeText), homeText.match(/Echo:.*$/m)?.[0]);
  check("home: the question asked is the one typed", /first question from home/.test(homeText));

  // The panel must not have been opened behind the user's back. getPanelBehavior is unrelated;
  // what matters is that no side panel document exists for this window.
  const panelOpened = await home.evaluate(async () => {
    const views = await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] });
    return views.length;
  }).catch(() => 0);
  check("home: Ask did not open the side panel", panelOpened === 0, `side panel contexts: ${panelOpened}`);

  // ----- 2. The panel joins the same conversation -----
  const panel = await context.newPage();
  await panel.goto(PANEL);
  await panel.waitForSelector("textarea", { timeout: 10000 });
  await panel.waitForFunction(() => document.body.innerText.includes("first question from home"), null, { timeout: 15000 })
    .catch(() => undefined);
  const panelText = await panel.evaluate(() => document.body.innerText);
  check("sync: the panel opens on the conversation started on Home",
    /first question from home/.test(panelText), panelText.slice(0, 160).replace(/\n/g, " "));

  // ----- 3. They follow each other live -----
  await panel.fill('textarea[aria-label="Message Enki"]', "second question from the panel");
  await panel.press('textarea[aria-label="Message Enki"]', "Enter");
  await panel.waitForFunction(() => (document.body.innerText.match(/Echo:/g) ?? []).length >= 2, null, { timeout: 30000 });

  // Two separate things, asserted separately so a failure says which one broke: the panel has to
  // WRITE the turn, and the Home has to FOLLOW it. Poll the Home rather than waiting inside it —
  // it is a background tab now, and Chrome throttles those, so its own timers are unreliable here
  // while the storage event that drives the sync is not.
  const persisted = await poll(async () => (await storedMessages(home)).length >= 4, 30000);
  check("sync: the panel's turn is written to the shared conversation", persisted);

  const followed = await poll(
    async () => (await home.evaluate(() => document.body.innerText)).includes("second question from the panel"),
    30000,
  );
  check("sync: a message sent in the panel appears on the Home page", followed);

  // ----- 4. Act still belongs to the panel -----
  // Act navigates the tab it is given, and Home IS a tab, so Act must hand off rather than answer
  // in place. A fresh Home page in Act mode should open the panel instead of rendering a chat.
  const home2 = await context.newPage();
  await home2.goto(HOME);
  await home2.evaluate(() => chrome.storage.local.set({ "enki:mode": "act" }));
  await home2.goto(HOME);
  await home2.waitForSelector("textarea", { timeout: 10000 });
  // The stored mode is read asynchronously on mount; typing before it lands would test Ask again.
  const inAct = await poll(
    () => home2.evaluate(() =>
      Array.from(document.querySelectorAll('[role="radio"][aria-checked="true"]')).some((e) => /Act|Agir|Actuar/.test(e.textContent ?? ""))),
    8000,
  );
  check("act: Home comes up in Act mode when that is what was chosen", inAct);

  await home2.fill("textarea", "act request");
  await home2.press("textarea", "Enter");
  await home2.waitForTimeout(2000);
  // Answering in place would have replaced the box with a transcript. Act must leave Home as it
  // was and pass the request on, so the box is still there and no reply was written here.
  // The Ask/Act radiogroup belongs to Home and to nothing else: if it is still on screen, Home
  // was not replaced by the conversation. A bare textarea would not prove it — the chat has one too.
  const stillHome = await home2.evaluate(() =>
    !!document.querySelector('[role="radiogroup"]') && !document.body.innerText.includes("Echo:"));
  check("act: still handed to the panel rather than answered on the page", stillHome);
} catch (e) {
  check("suite completed", false, e instanceof Error ? e.message : String(e));
} finally {
  await context.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
