// #115: Enki Home torn off into another window addresses the panel and the handoff to the NEW
// window, not the one it was opened in. Prereqs: `npm run build` and Playwright's Chromium.
// No model needed: the Act request is checked where Home leaves it (session storage).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "..", "dist");
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const context = await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(), "enki-tearoff-")), {
  headless: false,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--window-size=1200,900"],
});
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const HOME = `chrome-extension://${extId}/src/home/index.html`;
  await sw.evaluate(() => chrome.storage.local.set({ "enki:mode": "act" }));

  const home = await context.newPage();
  await home.goto(HOME);
  const homeTab = await sw.evaluate((url) => chrome.tabs.query({ url: `${url}*` }).then((t) => ({ id: t[0].id, windowId: t[0].windowId })), HOME);

  const ask = async (text) => {
    await sw.evaluate(() => chrome.storage.session.remove("enki:handoff"));
    const box = home.locator("textarea").first();
    await box.fill(text);
    await box.press("Enter");
    for (let i = 0; i < 25; i++) {
      const h = await sw.evaluate(() => chrome.storage.session.get("enki:handoff").then((v) => v["enki:handoff"]));
      if (h) return h;
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  };

  const before = await ask("click the first link");
  check("single window: handoff goes to the window Home is in", before?.windowId === homeTab.windowId, `${before?.windowId} vs ${homeTab.windowId}`);

  // Tear-off: a new window, and Home's tab moved into it (what dragging the tab out does).
  const torn = await sw.evaluate(async (tabId) => {
    const w = await chrome.windows.create({ url: "about:blank", focused: true });
    await chrome.tabs.move(tabId, { windowId: w.id, index: -1 });
    await chrome.tabs.update(tabId, { active: true });
    return w.id;
  }, homeTab.id);
  await new Promise((r) => setTimeout(r, 500));
  const after = await ask("click the second link");
  check("after tear-off: handoff goes to the NEW window", after?.windowId === torn, `${after?.windowId} vs new ${torn} (old ${homeTab.windowId})`);
} finally {
  await context.close();
}
process.exit(failed ? 1 : 0);
