// Screenshots of the 0.8.12 model-address states and update notices (dark theme). Not part of CI.
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp } from "node:fs/promises";
import { chromium } from "playwright";
const dist = path.resolve("dist");
const outDir = "/workspace/enki-0812-shots";
await mkdir(outDir, { recursive: true });
const context = await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(), "enki-lh-")), {
  headless: false, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`], viewport: { width: 420, height: 760 },
});
const log = (...a) => console.log(...a);
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const id = new URL(sw.url()).host;
  const panel = await context.newPage();
  const url = `chrome-extension://${id}/src/sidepanel/index.html`;
  await panel.goto(url);
  const put = (settings, extra = {}) => panel.evaluate(async ({ settings, extra }) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ "enki:settings": { preset: "custom", model: "llama3.2:3b", vision: false, attachScreenshot: false,
      autoApprove: false, theme: "dark", saveConversations: true, acceptedTerms: "1", settingsVersion: 2, ...settings }, ...extra });
  }, { settings, extra });
  const shot = async (name) => {
    await panel.locator("[data-endpoint]").first().evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
    await panel.waitForTimeout(250); await panel.screenshot({ path: path.join(outDir, name) }); log("SHOT", name); };
  const openSettings = async () => {
    await panel.goto(url); await panel.waitForSelector("textarea");
    await panel.click("button[title='Settings']"); await panel.waitForSelector("input[aria-label='Base URL']");
  };
  const state = () => panel.getAttribute("[data-endpoint]", "data-endpoint").catch(() => null);
  const saveDisabled = () => panel.locator("button:has-text('Save')").last().isDisabled();
  const focusPolicy = async () => { await panel.locator("input[aria-label='Base URL']").scrollIntoViewIfNeeded(); };

  // 05a loopback
  await put({ baseUrl: "http://localhost:11434/v1" });
  await openSettings(); await focusPolicy();
  log("loopback", await state(), "saveDisabled", await saveDisabled());
  await shot("01-loopback-note.png");

  // 05b private IP, blocked, toggle off
  await panel.fill("input[aria-label='Base URL']", "http://192.168.1.20:11434/v1");
  log("private", await state(), "saveDisabled", await saveDisabled());
  await shot("02-private-ip-blocked-toggle-off.png");

  // 05c toggle on: warning + chip + Revoke
  await panel.getByRole("switch", { name: "Allow HTTP for this local address" }).click();
  log("private-on", await state(), "saveDisabled", await saveDisabled(), "revoke", await panel.getByRole("button", { name: "Revoke HTTP for 192.168.1.20:11434" }).count());
  await shot("03-private-ip-allowed-warning-chip-revoke.png");

  // Saved: the egress chip in the header, with Revoke
  await panel.locator("button:has-text('Save')").last().click();
  await panel.waitForSelector("[data-egress=local-http]");
  log("stored", JSON.stringify(await panel.evaluate(async () => (await chrome.storage.local.get("enki:settings"))["enki:settings"].localHttpOrigins)));
  await panel.screenshot({ path: path.join(outDir, "04-header-egress-chip-revoke.png"), clip: { x: 0, y: 0, width: 420, height: 120 } }); log("SHOT 04");
  await panel.getByRole("button", { name: "Revoke HTTP for 192.168.1.20:11434" }).click(); await panel.waitForTimeout(300);
  log("after revoke chip", await panel.locator("[data-egress=local-http]").count(), "stored",
    JSON.stringify(await panel.evaluate(async () => (await chrome.storage.local.get("enki:settings"))["enki:settings"].localHttpOrigins)));
  await panel.click("button[title='Settings']"); await panel.waitForSelector("input[aria-label='Base URL']"); await focusPolicy();
  log("reopened after revoke", await state());
  await shot("05-after-revoke-back-to-blocked.png");

  // 05d hostname refused
  await panel.fill("input[aria-label='Base URL']", "http://ollama.local:11434/v1");
  log("hostname", await state(), "saveDisabled", await saveDisabled());
  await shot("06-hostname-refused.png");

  // public IP refused
  await panel.fill("input[aria-label='Base URL']", "http://203.0.113.7:8080/v1");
  log("public", await state(), "saveDisabled", await saveDisabled());
  await shot("07-public-ip-refused.png");

  // 05e key over HTTP (private IP with the exception on, and a key typed)
  await put({ baseUrl: "http://192.168.1.20:11434/v1", localHttpOrigins: ["http://192.168.1.20:11434"] });
  await openSettings(); await focusPolicy();
  await panel.fill("input[aria-label='API key']", "sk-test-1234");
  log("key", await state(), "saveDisabled", await saveDisabled());
  await shot("08-key-over-http-blocked.png");

  // One-time notices: settings saved by 0.8.11 (settingsVersion 1).
  const notice = async (name, settings) => {
    await put({ settingsVersion: 1, ...settings });
    await panel.goto(url); await panel.waitForSelector("[data-notice]");
    log("notice", name, await panel.getAttribute("[data-notice]", "data-notice"));
    await panel.screenshot({ path: path.join(outDir, name), clip: { x: 0, y: 0, width: 420, height: 300 } }); log("SHOT", name);
  };
  await notice("09-notice-carried.png", { baseUrl: "http://192.168.1.20:11434/v1" });
  {
    const card = panel.locator("[data-notice=carried]");
    const t = await card.textContent();
    const ok = t.includes("It stays on for http://192.168.1.20:11434 because you set it up that way.") &&
      t.includes("Not encrypted: anyone on the same Wi-Fi can read your questions and page content.") &&
      (await card.getByRole("button", { name: "Revoke HTTP for 192.168.1.20:11434" }).count()) === 1;
    log("carried notice body+warn+revoke together", ok);
    if (!ok) throw new Error("carried notice incomplete: " + t);
  }
  log("carried stored", JSON.stringify(await panel.evaluate(async () => (await chrome.storage.local.get("enki:settings"))["enki:settings"].localHttpOrigins)));
  await notice("10-notice-blocked-hostname.png", { baseUrl: "http://ollama.local:11434/v1" });
  await notice("11-notice-blocked-public-ip.png", { baseUrl: "http://203.0.113.7:8080/v1" });
  await notice("12-notice-blocked-private-ip-with-key.png", { baseUrl: "http://192.168.1.20:11434/v1", apiKeys: { custom: "sk-test-1234" } });
  // Not reachable with CARRY_OVER_PRIVATE_HTTP = true; shown by planting the notice the "off" build writes.
  await put({ baseUrl: "http://192.168.1.20:11434/v1" }, { "enki:endpoint-notice": { kind: "private-off", origin: "http://192.168.1.20:11434" } });
  await panel.goto(url); await panel.waitForSelector("[data-notice]");
  await panel.screenshot({ path: path.join(outDir, "13-notice-carry-over-off-variant.png"), clip: { x: 0, y: 0, width: 420, height: 300 } }); log("SHOT 13");
  // Loopback: no notice.
  await put({ settingsVersion: 1, baseUrl: "http://localhost:11434/v1", apiKeys: { custom: "sk-x" } });
  await panel.goto(url); await panel.waitForSelector("textarea"); await panel.waitForTimeout(400);
  log("loopback notice count", await panel.locator("[data-notice]").count());
  console.log("SHOTS OK");
} catch (e) {
  console.error("FAIL", e.message);
  process.exitCode = 1;
} finally { await context.close(); }
