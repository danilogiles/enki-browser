// On-device voice input, end to end: a recorded sentence plays as the microphone, the composer's
// microphone button records it, Whisper turns it into text on this machine, and the text lands
// in the message box. Downloads the model once (~80 MB) from Hugging Face; nothing else may be
// fetched from outside the extension, code above all.
//
// Prereqs: `npm run build`, `npx playwright install chromium`, a speech WAV (test/fixtures/voice.wav
// or ENKI_VOICE_WAV). On Windows one can be made with System.Speech; see the README in test/.
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
const wav = process.env.ENKI_VOICE_WAV ?? path.join(here, "fixtures", "voice.wav");
if (!existsSync(wav)) { console.log(`SKIP no speech sample at ${wav}`); process.exit(0); }

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const context = await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(), "enki-voice-")), {
  headless: false,
  args: [
    `--disable-extensions-except=${dist}`, `--load-extension=${dist}`,
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`,
  ],
  viewport: { width: 420, height: 760 },
});
const outside = [];
context.on("request", (r) => {
  const u = new URL(r.url());
  if (u.protocol === "chrome-extension:" || u.hostname === "127.0.0.1") return;
  // The model's files are the one thing voice downloads.
  if (/(^|\.)huggingface\.co$|(^|\.)hf\.co$|xethub\.hf\.co$/.test(u.hostname)) return;
  outside.push(`${r.resourceType()} ${u.hostname}${u.pathname.slice(0, 40)}`);
});
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const id = new URL(sw.url()).host;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html`);
  await panel.evaluate(() => chrome.storage.local.set({ "enki:settings": { preset: "custom", baseUrl: "http://127.0.0.1:9/v1", apiKey: "t", model: "x", vision: false, theme: "dark", customInstructions: "", saveConversations: false, acceptedTerms: "1" } }));
  await panel.reload(); await panel.waitForSelector("textarea");
  const mic = panel.locator("button[aria-label^='Speak instead']");
  check("the composer has a microphone button", await mic.count() === 1);
  await mic.click();
  check("pressing it starts listening", await panel.waitForSelector("button[aria-pressed='true'][aria-label^='Listening']", { timeout: 15000 }).then(() => true, () => false));
  await panel.waitForTimeout(6000); // the sample is about five seconds long
  await panel.locator("button[aria-label^='Listening']").click();
  const started = Date.now();
  await panel.waitForFunction(() => document.querySelector("textarea")?.value.trim().length > 0 || /could not|error|failed/i.test(document.querySelector("[role=status]")?.textContent ?? ""), null, { timeout: 300000 });
  const text = await panel.inputValue("textarea");
  const status = await panel.locator("[role=status]").textContent().catch(() => "");
  check("the speech becomes text in the message box", /weather|forecast|enki/i.test(text), `"${text}" in ${Math.round((Date.now() - started) / 1000)}s ${status ?? ""}`);
  check("nothing but the model is fetched from outside", outside.length === 0, outside.slice(0, 5).join(", "));
  // Second time: the model is cached, so it is quick and offline.
  await panel.fill("textarea", "");
  await mic.click(); await panel.waitForTimeout(6000); await panel.locator("button[aria-label^='Listening']").click();
  const again = Date.now();
  await panel.waitForFunction(() => document.querySelector("textarea")?.value.trim().length > 0, null, { timeout: 120000 });
  check("the second time uses the cached model", Date.now() - again < 60000, `${Math.round((Date.now() - again) / 1000)}s`);
} catch (e) {
  check("run", false, e?.message ?? String(e));
} finally {
  await context.close();
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
