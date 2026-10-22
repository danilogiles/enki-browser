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
        theme: "dark", customInstructions: "", saveConversations: true, acceptedTerms: "1", settingsVersion: 1, ...extra }, "enki:mode": mode });
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
  // `panel` controls the test window, not Home's. Before the fix it took the request anyway (Act
  // typed in a new window ran in another window's panel). It must stay with Home's own window.
  await panel.waitForTimeout(800);
  check("Act typed on Home does not run in another window's panel", !(await panel.textContent("body")).includes("hello from enki home")
    && await home.evaluate(async () => (await chrome.storage.session.get("enki:handoff"))["enki:handoff"]?.windowId === window.__opened[0].windowId));
  // The panel for Home's own window (a tab here, pointed at it with ?window=) is the one that sends it.
  const homeUrl = panel.url();
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html?window=${opened[0].windowId}`);
  await panel.waitForFunction(() => document.body.innerText.includes("Echo:") && document.body.innerText.includes("hello from enki home"), null, { timeout: 15000 });
  await idle();
  check("the panel sends the Enki Home request to the model", (await panel.textContent("body")).includes("hello from enki home"));
  check("an Enki Home request is sent only once", await home.evaluate(async () => !(await chrome.storage.session.get("enki:handoff"))["enki:handoff"]));
  await panel.goto(homeUrl); await panel.waitForSelector("textarea");
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
  // Keyboard and screen readers (#34): arrow keys move between tabs, each tab names its panel,
  // the chart has its numbers in words, and foldable mind map nodes are buttons.
  await panel.focus("[role=tab][aria-selected=true]");
  await panel.keyboard.press("ArrowLeft");
  const tabsA11y = await panel.evaluate(() => {
    const sel = document.querySelector("[role=tab][aria-selected=true]");
    const tabpanel = document.getElementById(sel?.getAttribute("aria-controls") ?? "");
    return { selected: sel?.textContent, focused: document.activeElement === sel, panel: tabpanel?.getAttribute("role"),
      stops: [...document.querySelectorAll("[role=tab]")].filter((t) => t.tabIndex === 0).length };
  });
  check("Left arrow moves from Table to Pie, focus follows, aria-controls names the tab panel",
    tabsA11y.selected === "Pie" && tabsA11y.focused && tabsA11y.panel === "tabpanel" && tabsA11y.stops === 1, JSON.stringify(tabsA11y));
  await panel.keyboard.press("Home");
  check("the chart has a text alternative with its numbers",
    /^Bar chart: Votes: Ana 1.200.000; Bruno 1.140.000\. %: Ana 51.2; Bruno 48.8/.test((await panel.locator("[role=tabpanel] .sr-only").textContent())?.replace(/[,.\u202f\u00a0]/g, ".") ?? ""));
  const node = panel.locator("svg[aria-label^='Mind map'] [role=button]").last(); // the root, drawn last
  check("foldable mind map nodes are focusable buttons", await panel.locator("svg[aria-label^='Mind map'] [role=button][tabindex='0'][aria-expanded=true]").count() === 3);
  await node.focus(); await panel.keyboard.press("Enter");
  check("Enter folds a mind map node", await node.getAttribute("aria-expanded") === "false" && await panel.locator("svg[aria-label^='Mind map'] rect").count() === 1);
  await panel.keyboard.press(" ");
  check("Space opens it again", await panel.locator("svg[aria-label^='Mind map'] rect").count() === 6);

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

  // The per-message screenshot (0.3.6): off by default, off once for settings saved before, and a
  // later opt-in stays on. The camera button only shows with a model that takes images.
  const shot = () => panel.getAttribute("button[title^='Screenshot']", "title");
  const storedShot = () => panel.evaluate(async () => { const s = (await chrome.storage.local.get("enki:settings"))["enki:settings"]; return [s.attachScreenshot, s.settingsVersion]; });
  await configure("mock-echo", "ask", { vision: true, attachScreenshot: undefined });
  await panel.reload(); await panel.waitForSelector("button[title^='Screenshot']");
  check("screenshot: off by default with a model that takes images", /^Screenshot off/.test(await shot()));
  await configure("mock-echo", "ask", { vision: true, attachScreenshot: true, settingsVersion: undefined });
  await panel.reload(); await panel.waitForSelector("button[title^='Screenshot']"); await panel.waitForTimeout(300);
  check("screenshot: settings saved by 0.3.5 with it on are turned off once, on the first load", /^Screenshot off/.test(await shot()) && JSON.stringify(await storedShot()) === "[false,2]", JSON.stringify(await storedShot()));
  await panel.click("button[title^='Screenshot']"); await panel.waitForTimeout(300);
  check("screenshot: the camera button turns it back on", /^Screenshot attached/.test(await shot()) && JSON.stringify(await storedShot()) === "[true,2]");
  await panel.reload(); await panel.waitForSelector("button[title^='Screenshot']"); await panel.waitForTimeout(300);
  await panel.reload(); await panel.waitForSelector("button[title^='Screenshot']"); await panel.waitForTimeout(300);
  check("screenshot: the opt-in survives reloads (the migration does not run again)", /^Screenshot attached/.test(await shot()) && JSON.stringify(await storedShot()) === "[true,2]");
  await panel.click("button[title='Settings']"); await panel.click("button:has-text('Behavior')");
  const shotSwitch = panel.getByRole("switch", { name: "Attach a screenshot to every message" });
  check("screenshot: the Settings switch agrees and says it is off by default", await shotSwitch.getAttribute("aria-checked") === "true" && (await panel.textContent("body")).includes("Off by default."));
  await panel.getByRole("switch", { name: "Model supports images" }).click();
  check("screenshot: a text-only model disables the switch and shows it off", await shotSwitch.isDisabled() && await shotSwitch.getAttribute("aria-checked") === "false");
  await panel.click("button[title='Back']");
  await configure("mock-echo", "ask");
  await panel.reload(); await panel.waitForSelector("textarea");
  check("screenshot: no camera button with a text-only model", await panel.locator("button[title^='Screenshot']").count() === 0);

  // 0.8.12: plain HTTP to the model only on this computer, or a local IP the user allows one by one.
  {
    const LAN = "http://192.168.1.20:11434";
    const stored = () => panel.evaluate(async () => (await chrome.storage.local.get("enki:settings"))["enki:settings"].localHttpOrigins ?? []);
    const save = () => panel.locator("button:has-text('Save')").last();
    await configure("mock-echo", "ask", { baseUrl: LAN + "/v1", apiKey: "", settingsVersion: 2 });
    await panel.reload(); await panel.waitForSelector("textarea");
    await panel.click("button[title='Settings']");
    check("local HTTP: a private IP is blocked with the toggle off and Save disabled",
      await panel.getAttribute("[data-endpoint]", "data-endpoint") === "private-off" && await save().isDisabled());
    await panel.getByRole("switch", { name: "Allow HTTP for this local address" }).click();
    check("local HTTP: allowing it shows the warning, the chip and Revoke",
      (await panel.textContent("body")).includes("Not encrypted: anyone on the same Wi-Fi can read your questions and page content.") &&
      await panel.getByRole("button", { name: "Revoke HTTP for 192.168.1.20:11434" }).count() === 1 && !(await save().isDisabled()));
    await save().click(); await panel.waitForSelector("[data-egress=local-http]");
    check("local HTTP: Save stores that exact origin and the header shows the chip", JSON.stringify(await stored()) === JSON.stringify([LAN]));
    await panel.getByRole("button", { name: "Revoke HTTP for 192.168.1.20:11434" }).click(); await panel.waitForTimeout(300);
    check("local HTTP: Revoke deletes the exception and removes the chip",
      JSON.stringify(await stored()) === "[]" && await panel.locator("[data-egress=local-http]").count() === 0);
    await panel.click("button[title='Settings']");
    for (const [url, state] of [["http://ollama.local:11434/v1", "hostname"], ["http://203.0.113.7/v1", "public"]]) {
      await panel.fill("input[aria-label='Base URL']", url);
      check(`local HTTP: ${state} over HTTP is refused and cannot be saved`, await panel.getAttribute("[data-endpoint]", "data-endpoint") === state && await save().isDisabled());
    }
    await panel.fill("input[aria-label='Base URL']", "http://127.0.0.1:8787/v1");
    await panel.fill("input[aria-label='API key']", "test");
    check("local HTTP: loopback with a key is fine and says it stays on this computer",
      await panel.getAttribute("[data-endpoint]", "data-endpoint") === "loopback" && !(await save().isDisabled()) &&
      (await panel.textContent("body")).includes("Requests stay on this computer. Nothing goes over the network."));
    await panel.click("button[title='Back']");
    // The one-time notice after the update: in the panel only, never in the chat or its history.
    await configure("mock-echo", "ask", { baseUrl: LAN + "/v1", apiKey: "", settingsVersion: 1 });
    await panel.reload(); await panel.waitForSelector("[data-notice=carried]");
    check("local HTTP: settings from 0.8.11 keep a keyless private IP and say so once", JSON.stringify(await stored()) === JSON.stringify([LAN]));
    const card = panel.locator("[data-notice=carried]");
    const cardText = await card.textContent();
    check("local HTTP: the carried-over notice shows the body with the address, the unencrypted warning and Revoke together",
      cardText.includes("Enki now asks before using HTTP on your local network. It stays on for http://192.168.1.20:11434 because you set it up that way.") &&
      cardText.includes("Not encrypted: anyone on the same Wi-Fi can read your questions and page content.") &&
      await card.getByRole("button", { name: "Revoke HTTP for 192.168.1.20:11434" }).count() === 1, cardText);
    const leaked = await panel.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    check("local HTTP: the notice is not part of any chat", !/HTTP is still on/.test(leaked) && await panel.locator("[data-notice] ~ * :text('HTTP is still on')").count() === 0);
    await panel.click("[data-notice] button:has-text('Got it')"); await panel.reload(); await panel.waitForSelector("textarea"); await panel.waitForTimeout(300);
    check("local HTTP: the notice is shown once", await panel.locator("[data-notice]").count() === 0);
    await configure("mock-echo", "ask");
  }

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

  // 0.8.10 "Search engine" setting: Other is saved without opening anything; search.html then goes to DuckDuckGo, no AI call.
  const sp = await context.newPage();
  await sp.goto(`chrome-extension://${id}/src/sidepanel/index.html`);
  await sp.click("button[title='Settings']");
  const seTabsBefore = (await sp.evaluate(async () => (await chrome.tabs.query({})).length));
  const netOnPick = [];
  const onReq = (r) => { if (!r.url().startsWith("chrome")) netOnPick.push(r.url()); };
  context.on("request", onReq);
  await sp.click("[role=radio][data-engine=other]"); await sp.waitForTimeout(400);
  context.off("request", onReq);
  check("Other search engine is saved", await sp.evaluate(async () => (await chrome.storage.local.get("enki:searchEngine"))["enki:searchEngine"]) === "other");
  check("choosing Other opens nothing and makes no request", (await sp.evaluate(async () => (await chrome.tabs.query({})).length)) === seTabsBefore && netOnPick.length === 0);
  check("Other shows the click-only settings button and icon notice", await sp.locator("button:has-text('Open search engine settings')").count() === 1 && (await sp.textContent("body")).includes("This Chromium page loads icons for other search engines when it opens.") && (await sp.textContent("body")).includes("⋮\u00a0›\u00a0Make\u00a0default"));
  check("Enki AI names the provider and what is sent", (await sp.textContent("body")).includes("Only what you type is sent, not your tabs or history.") && !(await sp.textContent("body")).includes("Set up a model first"));
  await sp.close();
  await context.route("https://duckduckgo.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>ddg</title>" }));
  const aiCalls = [];
  const onAi = (r) => { if (r.url().includes("127.0.0.1:8787/v1")) aiCalls.push(r.url()); };
  context.on("request", onAi);
  const os2 = await context.newPage();
  await os2.goto(`chrome-extension://${id}/search.html?q=${encodeURIComponent("best headphones 2026")}`).catch(() => {});
  await os2.waitForURL(/duckduckgo\.com/, { timeout: 10000 });
  await os2.waitForTimeout(500);
  context.off("request", onAi);
  check("with Other, an address-bar search goes to DuckDuckGo with only q and no AI call", new URL(os2.url()).searchParams.get("q") === "best headphones 2026" && [...new URL(os2.url()).searchParams.keys()].length === 1 && aiCalls.length === 0);
  await os2.close();

  // Enki AI picked but setup pending: Settings shows Enki AI with the 2-step checklist, yet the
  // address bar still goes to DuckDuckGo (only q, no AI call) until Shield confirms both steps.
  // Shield's reply is stubbed in the page (same as the 02/05 screenshots); focus re-asks it.
  await configure("mock-echo", "ask");
  const pp = await context.newPage();
  await pp.goto(`chrome-extension://${id}/src/sidepanel/index.html?view=settings`); await pp.waitForSelector("text=Search engine");
  const shieldSays = async (reply) => { await pp.evaluate((r) => { chrome.runtime.sendMessage = async () => r; window.dispatchEvent(new Event("focus")); }, reply); await pp.waitForTimeout(400); };
  const seStored = () => pp.evaluate(async () => (await chrome.storage.local.get(["enki:searchEngine", "enki:searchSetupPending"])));
  await shieldSays({ allowed: false, searchSetupDone: false });
  await pp.click("[role=radio][data-engine=enki]");
  await pp.waitForSelector("text=Finish setup (0 of 2 done)");
  const pendBody = await pp.textContent("body");
  check("setup pending: Enki AI card is shown selected", await pp.getAttribute("[role=radio][data-engine=enki]", "aria-checked") === "true");
  check("setup pending: the 2-step checklist is visible", await pp.isVisible("text=Allow Enki Shield in Incognito") && await pp.isVisible("text=Make Enki your default search") && pendBody.includes("Finish setup (0 of 2 done)") && await pp.isVisible("text=Until then, searches go to DuckDuckGo."));
  const navBefore = await context.pages().length;
  const ubLine = "text=For ad blocking in private windows, also allow uBlock Origin Lite in Incognito.";
  check("setup pending: the uncounted uBlock line and its button are visible", await pp.isVisible(ubLine) && await pp.isVisible("button:has-text('Open uBlock settings')"));
  check("setup pending: the uBlock line has no checkbox and the count stays n of 2", await pp.locator("[data-testid=ublock-incognito] [aria-label='Not done'], [data-testid=ublock-incognito] [aria-label='Done'], [data-testid=ublock-incognito] input").count() === 0 && pendBody.includes("Finish setup (0 of 2 done)") && !pendBody.includes("of 3"));
  check("setup pending: nothing opens uBlock's page before the click", context.pages().length === navBefore);
  const ubOpened = await pp.evaluate(async () => { const urls = []; const orig = chrome.tabs.create; chrome.tabs.create = async (o) => { urls.push(o.url); return {}; }; document.querySelectorAll("button").forEach((b) => { if (b.textContent === "Open uBlock settings") b.click(); }); await new Promise((r) => setTimeout(r, 100)); chrome.tabs.create = orig; return urls; });
  check("setup pending: clicking Open uBlock settings opens uBOL's details page", ubOpened.length === 1 && ubOpened[0] === "chrome://extensions/?id=nadeplcfbngnnnppbenfiicgnimdcaaj");
  const pendState = await seStored();
  check("setup pending: the saved engine stays DuckDuckGo and the request is pending", pendState["enki:searchEngine"] !== "enki" && pendState["enki:searchSetupPending"] === true);
  const aiPend = [];
  const onAiPend = (r) => { if (r.url().includes("127.0.0.1:8787/v1")) aiPend.push(r.url()); };
  context.on("request", onAiPend);
  const ps = await context.newPage();
  await ps.goto(`chrome-extension://${id}/search.html?q=${encodeURIComponent("best headphones 2026")}`).catch(() => {});
  await ps.waitForURL(/duckduckgo\.com/, { timeout: 10000 });
  await ps.waitForTimeout(800);
  context.off("request", onAiPend);
  check("setup pending: an address-bar search goes to DuckDuckGo with only q and no AI call", new URL(ps.url()).searchParams.get("q") === "best headphones 2026" && [...new URL(ps.url()).searchParams.keys()].length === 1 && aiPend.length === 0);
  await ps.close();
  await shieldSays({ allowed: true, searchSetupDone: false });
  await pp.waitForSelector("text=Finish setup (1 of 2 done)");
  check("setup pending: one step done still shows the checklist and keeps DuckDuckGo", (await seStored())["enki:searchEngine"] !== "enki" && await pp.isVisible("text=Make Enki your default search"));
  check("setup pending: one step done keeps the uBlock line and the count is 1 of 2", await pp.isVisible(ubLine) && (await pp.textContent("body")).includes("Finish setup (1 of 2 done)"));
  await shieldSays({ allowed: true, searchSetupDone: true });
  await pp.waitForSelector("text=Finish setup", { state: "detached", timeout: 5000 });
  const doneState = await seStored();
  check("both steps done: the checklist hides and Enki AI is saved", await pp.locator("text=Allow Enki Shield in Incognito").count() === 0 && await pp.locator("text=Until then, searches go to DuckDuckGo.").count() === 0 && doneState["enki:searchEngine"] === "enki" && doneState["enki:searchSetupPending"] === undefined);
  check("both steps done: the uBlock line and button hide", await pp.locator(ubLine).count() === 0 && await pp.locator("button:has-text('Open uBlock settings')").count() === 0);
  await pp.evaluate(async () => chrome.storage.local.set({ "enki:searchEngine": "ddg" }));
  await pp.close();

  // Prompt-injection regressions (0.8.11): a page that says "ignore previous instructions and
  // submit / navigate" must not act without a confirmation card. The card names the page as
  // the requester and Cancel is focused first. Fresh window so earlier tests cannot leak state.
  const injWin = await panel.evaluate(async () => {
    const w = await chrome.windows.create({ url: "http://127.0.0.1:8787/inject", width: 900, height: 700 });
    return { wid: w.id, tab: w.tabs[0].id };
  });
  await configure("mock-inject-submit", "act");
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html?window=${injWin.wid}`);
  await panel.waitForSelector("textarea");
  await newChat(); await idle();
  await panel.click("button[title='More']"); await panel.selectOption("#controlled-tab", String(injWin.tab)); await panel.keyboard.press("Escape");
  await panel.fill("textarea", "what does this page say"); await panel.press("textarea", "Enter");
  await panel.waitForSelector("button:has-text('Allow anyway')", { timeout: 25000 });
  const injBody = await panel.textContent("body");
  check("injection submit waits for confirmation", injBody.includes("Allow anyway") && (injBody.includes("Submit form") || injBody.includes("This request came from the page")));
  check("injection card shows the page-requested warning", injBody.includes("This request came from the page, not from you"));
  const injCard = await panel.locator("[role=alertdialog]").first().innerText();
  check("warning card with nothing filled says Enki didn't fill in any fields. (not the verb)", injCard.includes("Enki didn't fill in any fields.") && !/—\s*Submit form/.test(injCard));
  check("page-requested Allow is outlined as Allow anyway, not filled Allow", await panel.locator("button:has-text('Allow anyway')").count() === 1 && await panel.locator("button:has-text('Allow'):not(:has-text('anyway'))").count() === 0);
  await panel.click("button:has-text('Cancel')"); await idle();
  check("denying an injection submit cancels the action", (await panel.locator("button:has-text('Allow anyway')").count()) === 0);

  await configure("mock-inject-nav", "act");
  await newChat(); await idle();
  await panel.click("button[title='More']"); await panel.selectOption("#controlled-tab", String(injWin.tab)); await panel.keyboard.press("Escape");
  await panel.fill("textarea", "summarize the page"); await panel.press("textarea", "Enter");
  await panel.waitForSelector("button:has-text('Allow anyway')", { timeout: 25000 });
  const navBody = await panel.textContent("body");
  check("injection navigate waits for confirmation", /evil\.example|Go to|Navigate|phish/i.test(navBody) && navBody.includes("Allow anyway"));
  await panel.click("button:has-text('Cancel')"); await idle();
  const still = await panel.evaluate(async (id) => (await chrome.tabs.get(id)).url, injWin.tab);
  check("denying injection navigate leaves the tab on the fixture", still.includes("/inject"));

  // Same injection cases with autoApprove ON — page-requested must still ask (Cloak).
  await configure("mock-inject-submit", "act", { autoApprove: true });
  await newChat(); await idle();
  await panel.click("button[title='More']"); await panel.selectOption("#controlled-tab", String(injWin.tab)); await panel.keyboard.press("Escape");
  await panel.fill("textarea", "what does this page say"); await panel.press("textarea", "Enter");
  await panel.waitForSelector("button:has-text('Allow anyway')", { timeout: 25000 });
  check("injection submit still asks with autoApprove ON", await panel.locator("button:has-text('Allow anyway')").count() === 1);
  await panel.click("button:has-text('Cancel')"); await idle();
  await configure("mock-inject-nav", "act", { autoApprove: true });
  await newChat(); await idle();
  await panel.click("button[title='More']"); await panel.selectOption("#controlled-tab", String(injWin.tab)); await panel.keyboard.press("Escape");
  await panel.fill("textarea", "summarize the page"); await panel.press("textarea", "Enter");
  await panel.waitForSelector("button:has-text('Allow anyway')", { timeout: 25000 });
  check("injection navigate still asks with autoApprove ON", await panel.locator("button:has-text('Allow anyway')").count() === 1);
  await panel.click("button:has-text('Cancel')"); await idle();

  // Form submit confirm lists filled fields (Ink mock 01), not the verb again.
  await configure("mock-form-filled", "act");
  const formWin = await panel.evaluate(async () => {
    const w = await chrome.windows.create({ url: "http://127.0.0.1:8787/form", width: 900, height: 700 });
    return { wid: w.id, tab: w.tabs[0].id };
  });
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html?window=${formWin.wid}`);
  await panel.waitForSelector("textarea");
  await newChat(); await idle();
  await panel.click("button[title='More']"); await panel.selectOption("#controlled-tab", String(formWin.tab)); await panel.keyboard.press("Escape");
  await panel.fill("textarea", "fill the contact form and submit"); await panel.press("textarea", "Enter");
  await panel.waitForSelector("button:has-text('Allow')", { timeout: 45000 });
  const formBody = await panel.textContent("body");
  check("form submit card lists filled field names and values", formBody.includes("Name") && formBody.includes("Ada Lovelace") && formBody.includes("Company") && formBody.includes("Example Labs"));
  const cardText = await panel.locator("[role=alertdialog]").first().innerText();
  // Value box is the field list; the verb may appear once as the title.
  check("form submit value box lists fields, not only the verb", cardText.includes("Ada Lovelace") && cardText.includes("Example Labs") && (cardText.match(/Submit form/g) || []).length <= 2);
  check("normal confirm uses Allow (not Allow anyway) with Cancel", await panel.locator("button:has-text('Allow'):not(:has-text('anyway'))").count() === 1 && await panel.locator("button:has-text('Cancel')").count() === 1);
  await panel.click("button:has-text('Cancel')"); await idle();

  // Image buttons (Cloak, 0.8.11): a same-site search form whose <input type=image> has
  // formaction=https://evil.test/img must ask, even with autoApprove ON, and show the destination
  // as unknown. Control: the same form without the image button searches without a card.
  await configure("mock-image-search", "act", { autoApprove: true });
  const imgWin = await panel.evaluate(async () => {
    const w = await chrome.windows.create({ url: "http://127.0.0.1:8787/image-search", width: 900, height: 700 });
    return { wid: w.id, tab: w.tabs[0].id };
  });
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html?window=${imgWin.wid}`);
  await panel.waitForSelector("textarea");
  await newChat(); await idle();
  await panel.click("button[title='More']"); await panel.selectOption("#controlled-tab", String(imgWin.tab)); await panel.keyboard.press("Escape");
  await panel.fill("textarea", "search the catalog for red shoes"); await panel.press("textarea", "Enter");
  const imgCard = await panel.waitForSelector("[role=alertdialog]", { timeout: 25000 }).then(() => panel.locator("[role=alertdialog]").first().innerText()).catch(() => "");
  check("image-button search form asks with autoApprove ON", imgCard.length > 0, imgCard.slice(0, 120));
  check("image-button search form shows the destination as unknown", imgCard.includes("Unknown destination"));
  check("image-button search form never names evil.test or this site as the destination", !imgCard.includes("evil.test") && !imgCard.includes("127.0.0.1:8787"));
  if (imgCard) { await panel.click("button:has-text('Cancel')"); }
  await idle();
  const imgUrl = await panel.evaluate(async (id) => (await chrome.tabs.get(id)).url, imgWin.tab);
  check("cancelling the image-button search leaves the tab on the form", imgUrl.includes("/image-search"));
  await panel.evaluate(async (id) => { await chrome.tabs.update(id, { url: "http://127.0.0.1:8787/image-search?plain=1" }); }, imgWin.tab);
  await panel.waitForFunction(async (id) => (await chrome.tabs.get(id)).status === "complete", imgWin.tab, { timeout: 10000 });
  await newChat(); await idle();
  await panel.click("button[title='More']"); await panel.selectOption("#controlled-tab", String(imgWin.tab)); await panel.keyboard.press("Escape");
  await panel.fill("textarea", "search the catalog for red shoes"); await panel.press("textarea", "Enter");
  await panel.waitForFunction(() => document.body.innerText.includes("Searched.") || !!document.querySelector("[role=alertdialog]"), null, { timeout: 25000 });
  check("control: the same-site search form without an image button searches without a card", await panel.locator("[role=alertdialog]").count() === 0);
  await idle();

  console.log(`${checks}/${checks} checks passed`);
} finally { await context.close(); }
