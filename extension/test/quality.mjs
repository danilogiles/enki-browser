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
        theme: "dark", customInstructions: "", saveConversations: true, acceptedTerms: "1", ...extra }, "enki:mode": mode });
    }, { model, mode, extra });
    await panel.waitForTimeout(200);
  };
  const idle = () => panel.waitForFunction(() => !document.querySelector("button[title='Stop']"), null, { timeout: 20000 });
  // New chat lives in the "more" (⋯) menu now.
  const newChat = async () => { await panel.click("button[title='More']"); await panel.click("button[title='New chat']"); };
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
  await panel.click("button[title='More']"); await panel.click("button:has-text('Continue safely')");
  await panel.waitForTimeout(300); await idle();
  check("Continue explicitly reads the page first", (await panel.textContent("body")).includes("Read page (interactive)"));

  await newChat();
  await configure("mock-lock");
  await panel.reload(); await panel.waitForSelector("textarea");
  await panel.click("button[title='More']"); await panel.selectOption("#controlled-tab", String(target.tab)); await panel.keyboard.press("Escape");
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

  await newChat();
  await configure("mock-failure");
  await send("test repeated failures");
  check("repeated failure guard stops visibly", (await panel.textContent("body")).includes("same action failed three times"));
  check("completion summary reports failures", (await panel.textContent("body")).includes("3 failed"));

  await configure("mock-echo", "ask", { favoriteModels: ["mock-echo", "mock-reader"], askModel: "mock-echo", actModel: "mock-reader" });
  await panel.click("button[title^='Model:']");
  await panel.fill("#model-search", "reader");
  await panel.click("button[title='mock-reader']");
  await panel.waitForTimeout(200);
  check("favorite model can be searched and selected", await panel.evaluate(async () => (await chrome.storage.local.get("enki:settings"))["enki:settings"].model) === "mock-reader");
  await panel.click("button[title^='Ask:']"); await panel.waitForTimeout(200);
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
  check("disabling persistence deletes saved chats", await panel.evaluate(async () => { const s = await chrome.storage.local.get(null); return !s["enki:conversation"] && !s["enki:chats"] && !Object.keys(s).some((k) => k.startsWith("enki:chat:")); }));
  await configure("mock-no-headers");
  await panel.fill("textarea", "stop using keyboard"); await panel.press("textarea", "Enter");
  await panel.waitForSelector("button[title='Stop']"); await panel.press("textarea", "Escape"); await idle();
  check("Escape stops a waiting request", await panel.locator("button[title='Stop']").count() === 0);
  await newChat();
  await configure("mock-agent", "act");
  await panel.reload(); await panel.waitForSelector("textarea");
  await panel.fill("textarea", "test new chat during approval"); await panel.press("textarea", "Enter");
  await panel.waitForSelector("button:has-text('Allow')");
  await newChat(); await idle();
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

  // Enki Home, the half that still hands over. Ask now answers on the page itself — test/home.mjs
  // covers that, and the shared conversation behind it. Act cannot: it navigates the tab it is
  // given, and Home IS a tab, so it still opens the panel and sends the request from there.
  // The real side panel is stubbed so the panel under test (a tab) is the one that picks it up.
  await configure("mock-echo", "act");
  await newChat(); await idle();
  const home = await context.newPage();
  await home.goto(`chrome-extension://${id}/src/home/index.html`);
  await home.evaluate(() => { window.__opened = []; chrome.sidePanel.open = async (o) => { window.__opened.push(o); }; });
  // The stored mode is read asynchronously on mount; typing first would exercise Ask instead.
  await home.waitForFunction(
    () => Array.from(document.querySelectorAll('[role="radio"][aria-checked="true"]')).some((e) => /Act|Agir|Actuar/.test(e.textContent ?? "")),
    null, { timeout: 8000 });
  await home.fill("textarea", "hello from enki home");
  await home.press("textarea", "Enter");
  const opened = await home.evaluate(() => window.__opened);
  check("Enki Home opens the side panel for Act", opened.length === 1 && typeof opened[0].windowId === "number");
  // The open panel hears the handoff through storage.onChanged; no reload needed.
  await panel.waitForFunction(() => document.body.innerText.includes("Echo:") && document.body.innerText.includes("hello from enki home"), null, { timeout: 15000 });
  await idle();
  check("the panel sends the Enki Home request to the model", (await panel.textContent("body")).includes("hello from enki home"));
  check("an Enki Home request is sent only once", await home.evaluate(async () => !(await chrome.storage.session.get("enki:handoff"))["enki:handoff"]));
  await home.fill("textarea", "example.com");
  await home.press("textarea", "Enter");
  await home.waitForURL(/^https:\/\/example\.com\/?$/, { timeout: 15000 });
  check("an address typed on Enki Home is opened, not asked about", home.url().startsWith("https://example.com"));
  await home.close();
  // The clean chat: steps folded behind an arrow, hideable; past chats under the ⋯ menu.
  const visibleText = () => panel.evaluate(() => document.body.innerText);
  await configure("mock-reader", "act");
  await newChat(); await send("read the page 0");
  const folded = await visibleText();
  check("task steps are folded behind an arrow", /\d+ steps?/.test(folded) && !folded.includes("Read page") && (await panel.textContent("body")).includes("Read page"));
  await panel.click("button[aria-expanded='false']");
  check("the arrow expands the steps", (await visibleText()).includes("Read page"));
  await configure("mock-reader", "act", { showSteps: false });
  await newChat(); await send("read the page 0");
  check("task steps can be hidden entirely", !(await panel.textContent("body")).includes("Read page"));

  await configure("mock-echo", "ask");
  await newChat(); await send("first chat about apples");
  await newChat(); await send("second chat about pears");
  await panel.click("button[title='More']");
  const menuText = await visibleText();
  check("past chats are listed under ⋯", menuText.includes("first chat about apples") && menuText.includes("second chat about pears"));
  await panel.click("button[role='menuitem']:has-text('first chat about apples')"); await panel.waitForTimeout(300);
  const reopened = await visibleText();
  check("a past chat reopens from the list", reopened.includes("first chat about apples") && !reopened.includes("second chat about pears"));
  await panel.reload(); await panel.waitForSelector("textarea");
  check("the panel reopens the chat that was open", (await visibleText()).includes("first chat about apples"));
  await newChat(); await panel.reload(); await panel.waitForSelector("textarea");
  check("after New chat, reopening the panel starts empty", !(await visibleText()).includes("first chat about apples"));

  await configure("mock-echo", "ask", { theme: "custom", customTheme: { background: "#102030", surface: "#203040", text: "#f0f0f0", accent: "#ff8800" } });
  await panel.waitForTimeout(300);
  check("your own colours are applied", await panel.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ink-950").trim()) === "#102030");

  // Charts and mind maps: a table of numbers is drawn, with tabs to see it another way.
  await configure("mock-visual", "ask");
  await newChat(); await send("show the results");
  check("a table of numbers and a mind map are drawn", await panel.locator("figure.enki-visual").count() === 2);
  check("the chart opens as bars with Bar, Line, Pie and Table tabs",
    (await panel.locator("[role=tab]").allTextContents()).join(",") === "Bar,Line,Pie,Table" && await panel.locator("[role=tab][aria-selected=true]").textContent() === "Bar");
  await panel.click("[role=tab]:has-text('Pie')");
  check("the Pie tab draws a slice per row", await panel.locator("svg[aria-label='Pie chart'] path").count() === 2);
  await panel.click("[role=tab]:has-text('Table')");
  check("the Table tab shows the numbers as written", (await panel.locator("figure.enki-visual table").textContent()).includes("1.200.000"));
  check("the mind map has every node", await panel.locator("svg[aria-label^='Mind map'] rect").count() === 6);

  // The web: a page that builds its content with JavaScript is rendered in a background tab,
  // read, and closed again; the user's tab never moves.
  await configure("mock-web", "ask");
  const tabsBefore = await panel.evaluate(async () => (await chrome.tabs.query({})).length);
  await newChat(); await send("what are the live results");
  check("read_url reads a page that builds itself with JavaScript", (await panel.textContent("body")).includes("candidate A 51.2%"));
  check("read_url closes the tab it opened", await panel.evaluate(async () => (await chrome.tabs.query({})).length) === tabsBefore);
  await configure("mock-echo", "ask");
  await newChat(); await send("what day is it");
  check("every message tells the model the date", /\[Now\] \w+day, /.test(await panel.textContent("body")));

  // Unfiltered tone: only in developer mode, shown in the header, and the safety rules stay.
  await configure("mock-tone", "ask", { unfiltered: true, devMode: false });
  await newChat(); await send("tone check one");
  check("unfiltered does nothing outside developer mode", (await panel.textContent("body")).includes("tone-unfiltered=false") && await panel.locator("header >> text=unfiltered").count() === 0);
  await configure("mock-tone", "act", { unfiltered: true, devMode: true });
  await newChat(); await send("tone check two");
  const toneText = await panel.textContent("body");
  check("unfiltered in developer mode reaches the prompt and keeps the safety rules", toneText.includes("tone-unfiltered=true") && toneText.includes("safety-kept=true"));
  check("the header shows when unfiltered is on", await panel.locator("header >> text=unfiltered").count() === 1);
  await configure("mock-echo", "ask");

  // Connections: add an MCP server from Settings, sign in (OAuth with registration and PKCE),
  // then read tools run at once and write tools wait for the approval card.
  await panel.click("button[title='Settings']");
  await panel.click("button:has-text('Connections')");
  await panel.click("button:has-text('Other MCP server')");
  await panel.fill("input[aria-label='Connection name']", "Tracker");
  await panel.fill("input[aria-label='MCP server URL']", "http://127.0.0.1:8787/mcp");
  await panel.click("button:has-text('Add and connect')");
  await panel.waitForFunction(() => document.body.innerText.includes("2 tools"), null, { timeout: 20000 }).catch(() => undefined);
  check("an MCP server connects through its own sign-in and lists its tools", (await panel.textContent("body")).includes("2 tools"));
  const authStored = await panel.evaluate(async () => (await chrome.storage.local.get("enki:connection-auth"))["enki:connection-auth"]);
  check("the app's sign-in token is stored encrypted", Object.values(authStored ?? {}).every((v) => typeof v === "string" && v.startsWith("enc:v1:")) && !JSON.stringify(authStored).includes("mock-token"));
  await panel.click("button[aria-label=\"Show Tracker's tools\"]");
  check("read and write tools are told apart", (await panel.textContent("body")).includes("readSearch issues") || (await panel.locator("text=write").count()) >= 1);
  await panel.click("button[title='Back']");
  await configure("mock-mcp", "ask");
  await newChat();
  await panel.fill("textarea", "find checkout bugs and file one"); await panel.press("textarea", "Enter");
  await panel.waitForSelector("button:has-text('Allow')", { timeout: 20000 });
  check("an app's write tool waits for approval; its read tool did not", (await panel.textContent("body")).includes("Tracker: create_issue") && (await panel.textContent("body")).includes("Tracker: search_issues"));
  await panel.click("button:has-text('Allow')"); await idle(); await panel.waitForTimeout(300);
  const appText = await panel.textContent("body");
  check("app tool results come back to the model", appText.includes("APP-DONE") && appText.includes("Found MOCK-7") && appText.includes("Created MOCK-8"));
  await panel.fill("textarea", "@tr");
  check("typing @ suggests connected apps", (await panel.locator("[role=listbox] >> text=@tracker").count()) === 1);
  await panel.fill("textarea", "");

  // Saved tasks: made in Settings, run with /name plus extra words, in the task's own mode.
  await panel.click("button[title='Settings']");
  await panel.click("button:has-text('Connections')");
  await panel.click("button:has-text('New task')");
  await panel.fill("input[aria-label='Task name']", "standup");
  await panel.selectOption("select[aria-label='Task mode']", "ask");
  await panel.fill("textarea[aria-label='Task prompt']", "Say the standup words");
  await panel.click("button:has-text('Save task')");
  await panel.click("button[title='Back']");
  await configure("mock-echo", "act");
  await newChat();
  await panel.fill("textarea", "/stand");
  check("typing / suggests saved tasks", (await panel.locator("[role=listbox] >> text=/standup").count()) === 1);
  await panel.press("textarea", "Tab");
  await panel.type("textarea", "extra bit");
  await panel.press("textarea", "Enter");
  await panel.waitForFunction(() => document.body.innerText.includes("Echo:"), null, { timeout: 20000 }); await idle();
  const taskText = await panel.textContent("body");
  check("a saved task sends its prompt plus the extra words", taskText.includes("Say the standup words") && taskText.includes("extra bit"));

  // Conversations, the chat list and saved tasks are stored encrypted, never as readable text.
  await panel.waitForTimeout(500);
  const sealed = await panel.evaluate(async () => chrome.storage.local.get(null));
  const sealedText = JSON.stringify(sealed);
  const chatKeys = Object.keys(sealed).filter((k) => k.startsWith("enki:chat:"));
  check("conversations and the chat list are stored encrypted",
    chatKeys.length > 0 && chatKeys.every((k) => /^enc:v1:/.test(sealed[k].sealed)) && /^enc:v1:/.test(sealed["enki:chats"]?.sealed ?? ""),
    `${chatKeys.length} chats`);
  check("saved tasks are stored encrypted", /^enc:v1:/.test(sealed["enki:tasks"]?.sealed ?? ""));
  check("no conversation text or task prompt is readable in storage", !sealedText.includes("Say the standup words") && !sealedText.includes("extra bit") && !sealedText.includes("Echo:"));
  // A chat saved in plain text by an older version is sealed when read, and still opens.
  await panel.evaluate(async () => {
    const plain = { version: 1, savedAt: 1, history: [{ role: "user", parts: [{ type: "text", text: "old plain question" }] }], messages: [{ id: "m1", role: "user", text: "old plain question" }] };
    await chrome.storage.local.set({ "enki:chats": [{ id: "old", title: "old plain question", updatedAt: Date.now() }], "enki:chat:old": plain, "enki:current-chat": "old" });
  });
  await panel.reload(); await panel.waitForSelector("textarea"); await panel.waitForTimeout(800);
  const migratedChat = await panel.evaluate(async () => chrome.storage.local.get(["enki:chats", "enki:chat:old"]));
  check("an old plain-text chat is encrypted on first read and still opens",
    (await panel.textContent("body")).includes("old plain question") && /^enc:v1:/.test(migratedChat["enki:chats"]?.sealed ?? "") && /^enc:v1:/.test(migratedChat["enki:chat:old"]?.sealed ?? ""),
    JSON.stringify(Object.keys(migratedChat)));
  await newChat();

  // API keys belong to each provider, and a saved key is never shown again.
  const NV = "nvapi-TESTKEY0000000000001111";
  const OR = "sk-or-v1-TESTKEY000000000002222";
  await configure("mock-echo", "ask", { preset: "nvidia", apiKey: NV, apiKeys: { nvidia: NV } });
  await panel.click("button[title='Settings']");
  check("a saved key is shown masked, never in full", (await panel.textContent("[aria-label='Saved API key']")) === "nvapi-••••••1111" && !(await panel.content()).includes(NV));
  await panel.selectOption("select[aria-label='Provider']", "openrouter");
  check("switching provider does not carry the other provider's key", (await panel.inputValue("input[aria-label='API key']")) === "");
  await panel.fill("input[aria-label='API key']", OR);
  await panel.click("button:has-text('Save')"); await panel.waitForTimeout(300);
  await panel.click("button[title='Settings']");
  await panel.selectOption("select[aria-label='Provider']", "nvidia");
  check("switching back brings that provider's own key back", (await panel.textContent("[aria-label='Saved API key']")) === "nvapi-••••••1111" && !(await panel.content()).includes(OR));
  await panel.click("button[title='Back']");
  const raw = await panel.evaluate(async () => (await chrome.storage.local.get(null)));
  const rawText = JSON.stringify(raw);
  check("each provider's key is stored on its own, encrypted",
    /^enc:v1:/.test(raw["enki:settings"].apiKeys.nvidia) && /^enc:v1:/.test(raw["enki:settings"].apiKeys.openrouter) && !raw["enki:settings"].apiKey,
    JSON.stringify(Object.keys(raw["enki:settings"].apiKeys)));
  check("no key appears in plain text anywhere in storage", !rawText.includes(NV) && !rawText.includes(OR) && !rawText.includes("TESTKEY"));
  await panel.reload(); await panel.waitForSelector("textarea");
  await panel.click("button[title='Settings']");
  check("an encrypted key still works after a reload", (await panel.textContent("[aria-label='Saved API key']")) === "sk-or-v1-••••••2222");
  await panel.click("button[title='Back']");
  // Keys written as plain text by older versions are encrypted the first time they are read.
  await configure("mock-echo", "ask", { preset: "nvidia", apiKey: NV, apiKeys: undefined });
  await panel.reload(); await panel.waitForSelector("textarea"); await panel.waitForTimeout(300);
  const migrated = await panel.evaluate(async () => (await chrome.storage.local.get("enki:settings"))["enki:settings"]);
  check("a plain-text key from an older version is encrypted on first read", /^enc:v1:/.test(migrated.apiKeys?.nvidia) && !JSON.stringify(migrated).includes(NV));
  // The provider gets the real key, decrypted: point the (now encrypted) settings at the mock.
  await panel.evaluate(async () => {
    const s = (await chrome.storage.local.get("enki:settings"))["enki:settings"];
    await chrome.storage.local.set({ "enki:settings": { ...s, preset: "custom", baseUrl: "http://127.0.0.1:8787/v1", model: "mock-auth", apiKeys: { custom: s.apiKeys.nvidia } } });
  });
  await panel.reload(); await panel.waitForSelector("textarea");
  await newChat(); await send("which key");
  check("the provider receives the decrypted key, not the stored ciphertext", (await panel.textContent("body")).includes("auth-ends=1111 auth-encrypted=false"));
  await configure("mock-echo", "ask");

  // First use: a notice links the terms and the privacy policy until "Got it".
  await configure("mock-echo", "ask", { acceptedTerms: undefined });
  await panel.waitForTimeout(300);
  check("first use shows the terms and privacy notice", (await panel.locator("[role=note] >> text=Terms of Use").count()) === 1);
  await panel.click("[role=note] button:has-text('Got it')"); await panel.waitForTimeout(300);
  check("Got it hides the notice for good", (await panel.locator("[role=note]").count()) === 0 && await panel.evaluate(async () => (await chrome.storage.local.get("enki:settings"))["enki:settings"].acceptedTerms === "1"));

  // The answer page: Enki as the address bar's search engine opens the panel as a tab with ?q=.
  const openBefore = await panel.evaluate(async () => (await chrome.storage.local.get("enki:current-chat"))["enki:current-chat"]);
  const answer = await context.newPage();
  await answer.goto(`chrome-extension://${id}/src/sidepanel/index.html?q=${encodeURIComponent("who won today")}`);
  await answer.waitForFunction(() => document.body.innerText.includes("Echo:") && !document.querySelector("button[title='Stop']"), null, { timeout: 20000 });
  check("an address bar search is answered on its own page", (await answer.textContent("body")).includes("who won today") && await answer.title() === "who won today — Enki");
  check("the answer page has no Act mode (acting would navigate the answer away)", await answer.locator("button[title^='Act:']").count() === 0);
  check("the answer page leaves the panel's open chat alone", await panel.evaluate(async () => (await chrome.storage.local.get("enki:current-chat"))["enki:current-chat"]) === openBefore);
  await answer.close();
  console.log(`${checks}/${checks} checks passed`);
} finally { await context.close(); }
