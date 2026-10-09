// Updating Enki Browser keeps its extensions' backgrounds running the new code.
//
// The release before this one runs on a profile first; then this build starts on that same
// profile, as after an update. Chromium keeps an extension's service worker registered for the
// version it saw: when Enki's and Shield's versions did not change (0.8.4), the registration
// still named the previous build's worker file, which no longer existed, so no background ran
// and Ctrl+Shift+E did nothing — while every fresh-profile test passed. Checks, after the update:
//   - Enki's and Shield's workers run, from the files this build's manifests name;
//   - the real Ctrl+Shift+E (xdotool; synthetic keys never reach extension commands) opens the
//     side panel, not a popup window;
//   - Act still refuses an extension page (Shields' settings, with Burn all data): a scripted
//     model asks to read, click and press Enter there and every call comes back refused.
//
//   ENKI_OLD_LINUX_DIR=/path/to/previous/enki-browser ENKI_LINUX_DIR=/path/to/new/enki-browser \
//     xvfb-run -a node test/update-path.mjs
// Both are unpacked Linux tarballs (the launcher script is what starts them). Needs xdotool.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const oldDir = process.env.ENKI_OLD_LINUX_DIR;
const newDir = process.env.ENKI_LINUX_DIR;
if (!oldDir || !newDir || !existsSync(path.join(oldDir, "enki-browser")) || !existsSync(path.join(newDir, "enki-browser"))) {
  console.error("Set ENKI_OLD_LINUX_DIR and ENKI_LINUX_DIR to two unpacked Enki Browser Linux folders.");
  process.exit(2);
}
const xdotool = (...a) => execFileSync("xdotool", a, { encoding: "utf8" }).trim();
try { xdotool("version"); } catch { console.error("xdotool is required (apt-get install xdotool)"); process.exit(2); }

const ids = JSON.parse(readFileSync(path.join(newDir, "version.json"), "utf8"));
const manifest = (dir, ext) => JSON.parse(readFileSync(path.join(dir, "extensions", ext, "manifest.json"), "utf8"));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + ms;
  let last;
  do { last = await fn().catch(() => undefined); if (last) return last; await pause(250); } while (Date.now() < end);
  return last;
}
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

// A model that tries to work Shields' settings page; it records what each tool call returned.
const toolResults = [];
const SCRIPT = [["read_page", { filter: "interactive" }], ["click", { x: 200, y: 200 }], ["press_key", { key: "Enter" }]];
const mock = http.createServer((req, res) => {
  if (req.url === "/v1/models") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ data: [{ id: "mock-internal" }] })); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const { messages } = JSON.parse(body || "{}");
    const tools = (messages ?? []).filter((m) => m.role === "tool");
    toolResults.splice(0, toolResults.length, ...tools.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const sse = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const step = SCRIPT[tools.length];
    if (step) {
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${tools.length}`, type: "function", function: { name: step[0], arguments: JSON.stringify(step[1]) } }] }, finish_reason: null }] });
      sse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else {
      sse({ choices: [{ delta: { content: "Finished." }, finish_reason: null }] });
      sse({ choices: [{ delta: {}, finish_reason: "stop" }] });
    }
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const MOCK = `http://127.0.0.1:${mock.address().port}`;

const profile = mkdtempSync(path.join(os.tmpdir(), "enki-update-"));
let port = 9400 + Math.floor(Math.random() * 400);

/**
 * Starts a build through its launcher on the shared profile; returns the browser and a stop().
 * A browser that does not come up fails with the end of its stderr, which says why (on Ubuntu
 * 23.10+ usually the sandbox: no AppArmor profile for that binary's path).
 */
async function start(dir, extraArgs = []) {
  port++;
  const proc = spawn(path.join(dir, "enki-browser"), [`--remote-debugging-port=${port}`, "--window-size=1100,800", "--window-position=40,40", ...extraArgs, "about:blank"], {
    env: { ...process.env, ENKI_BROWSER_USER_DATA: profile }, stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", (d) => { stderr = (stderr + d).slice(-20000); });
  const browser = await until(() => (proc.exitCode !== null ? Promise.resolve("exited") : chromium.connectOverCDP(`http://127.0.0.1:${port}`)), 30000);
  if (!browser || browser === "exited") {
    proc.kill("SIGKILL");
    const tail = stderr.trim().split("\n").slice(-25).join("\n") || "(no stderr)";
    const err = new Error(`${dir} did not start${proc.exitCode !== null ? ` (exit ${proc.exitCode})` : ""}; its stderr ends:\n${tail}`);
    err.stderr = stderr;
    throw err;
  }
  const stop = async () => {
    await browser.close().catch(() => {});
    proc.kill("SIGTERM");
    await new Promise((r) => { if (proc.exitCode !== null) return r(); proc.on("exit", r); setTimeout(() => { proc.kill("SIGKILL"); r(); }, 10000); });
    await pause(1000);
  };
  return { browser, context: browser.contexts()[0], stop };
}

/**
 * The previous release only sets the stage: what is under test is this build on its profile.
 * CI installs an AppArmor profile for it (build.yml), as install.sh --apparmor does for this
 * build. If its sandbox still cannot start (a system that restricts user namespaces, without the
 * profile), it is started once more with --no-sandbox, said in the output. This build never is.
 */
async function startPrevious(dir) {
  try {
    return await start(dir);
  } catch (e) {
    if (!/namespace|sandbox|zygote/i.test(e.stderr ?? "")) throw e;
    console.log(`NOTE the previous release's sandbox could not start here; starting it with --no-sandbox (this build keeps its sandbox):\n${e.message}`);
    return start(dir, ["--no-sandbox"]);
  }
}
const workerOf = (context, id) => context.serviceWorkers().find((w) => new URL(w.url()).host === id);
/** The extension's worker; an extension page wakes a worker that is registered but asleep. */
async function wake(context, id) {
  let sw = await until(async () => workerOf(context, id), 5000);
  if (!sw) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/manifest.json`).catch(() => {});
    sw = await until(async () => workerOf(context, id), 10000);
    await page.close();
  }
  return sw;
}

try {
  // ---- the previous release, as people had it
  const old = await startPrevious(oldDir);
  const oldEnki = await wake(old.context, ids.enkiExtensionId);
  await wake(old.context, ids.shieldExtensionId);
  console.log(`previous release: Enki ${manifest(oldDir, "enki").version}, worker ${oldEnki && new URL(oldEnki.url()).pathname}`);
  await pause(1500);
  await old.stop();

  // ---- this build on the same profile
  const now = await start(newDir);
  const { context } = now;
  for (const [ext, id] of [["enki", ids.enkiExtensionId], ["shield", ids.shieldExtensionId]]) {
    const before = manifest(oldDir, ext), after = manifest(newDir, ext);
    check(`${ext}: the version changes with the update`, before.version !== after.version, `${before.version} → ${after.version}`);
    const sw = await wake(context, id);
    const expected = `/${after.background.service_worker.replace(/^\//, "")}`;
    check(`${ext}: the background runs this build's worker after the update`, sw && new URL(sw.url()).pathname === expected, sw ? sw.url() : "no worker running");
  }
  const sw = workerOf(context, ids.enkiExtensionId);
  if (!sw) throw new Error("Enki's worker is not running; the rest cannot be checked");

  // Ctrl+Shift+E, pressed for real.
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("about:blank");
  await page.bringToFront();
  await pause(800);
  const panels = () => sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })).length);
  const win = xdotool("search", "--onlyvisible", "--class", "enki-browser").split(/\s+/).pop();
  xdotool("windowfocus", "--sync", win);
  xdotool("key", "--clearmodifiers", "ctrl+shift+e");
  const opened = await until(panels, 5000);
  const popups = await sw.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ["popup"] })).length);
  check("Ctrl+Shift+E opens the side panel after the update", opened === 1, `side panels: ${opened ?? 0}`);
  check("and no popup window instead", popups === 0, `popups: ${popups}`);

  // Act on Shields' settings: every step refused.
  const shieldsUrl = `chrome-extension://${ids.shieldExtensionId}/options.html`;
  // The panel page first: a new page opens in the last focused window, and must not land in the
  // window Act controls.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${ids.enkiExtensionId}/src/sidepanel/index.html`);
  await panel.evaluate(async (base) => {
    const key = "enki:settings";
    const current = (await chrome.storage.local.get(key))[key] ?? {};
    await chrome.storage.local.set({ [key]: { ...current, preset: "custom", apiKey: "test", baseUrl: `${base}/v1`, model: "mock-internal", autoApprove: true, vision: false, attachScreenshot: false, maxSteps: 6, saveConversations: false }, "enki:mode": "act" });
  }, MOCK);
  const target = await sw.evaluate(async (url) => (await chrome.windows.create({ url, width: 1000, height: 760, focused: true })).id, shieldsUrl);
  await panel.goto(`chrome-extension://${ids.enkiExtensionId}/src/sidepanel/index.html?window=${target}`);
  await panel.waitForSelector("textarea", { timeout: 15000 });
  await panel.click("button[title^='Act:']").catch(() => {});
  await panel.fill("textarea", "Press Burn everything now");
  await panel.press("textarea", "Enter");
  await until(async () => {
    const allow = panel.locator("button:has-text('Allow')");
    if (await allow.count()) await allow.first().click().catch(() => {});
    return toolResults.length >= SCRIPT.length || (await panel.evaluate(() => document.body.innerText.includes("Finished.")));
  }, 30000);
  const refused = toolResults.filter((t) => /browser-internal page|Security restriction/.test(t) && t.includes(shieldsUrl));
  check("Act is refused on Shields' settings after the update (read, click, key)", toolResults.length === SCRIPT.length && refused.length === SCRIPT.length, JSON.stringify(toolResults.map((t) => t.slice(0, 110))));
  const stillThere = await sw.evaluate(async (url) => (await chrome.tabs.query({ url })).length, shieldsUrl);
  check("nothing was burned (the Shields tab is still open)", stillThere === 1);
  await now.stop();
} catch (e) {
  check("update path", false, e.stack ?? String(e));
} finally {
  mock.close();
  rmSync(profile, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
