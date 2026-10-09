// First-run guide (shield/default-browser.js + welcome.html): with a fake launcher and fake
// storage. Covers when it opens, that it opens at most once per profile, that Pular guia closes
// the whole flow, that Agora não only advances, that Tornar padrão talks to the native host, that
// Settings can reopen it, and that deciding needs nothing but the launcher's local registry read.
//
//   node test/shield-welcome.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE, SEEN, defaultStatus, openDefaultApps, welcomeOnce } from "../shield/default-browser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// Nothing here may reach the network.
globalThis.fetch = () => { throw new Error("network used"); };

function profile(reply) {
  const data = {}, pages = [], messages = [];
  const env = {
    data, pages, messages,
    reply,
    native: async (m) => { messages.push(m.type); await new Promise((r) => setTimeout(r, 5)); return typeof env.reply === "function" ? env.reply(m) : env.reply; },
    storage: { get: async (k) => ({ [k]: data[k] }), set: async (o) => { Object.assign(data, o); } },
    openPage: async (p) => { pages.push(p); },
  };
  env.show = welcomeOnce(env);
  return env;
}

{
  const p = profile(null);
  const r = await p.show();
  check("no launcher (Linux, macOS): guide opens once", r === "shown" && p.pages.join() === PAGE && SEEN in p.data, r);
  const again = await p.show();
  check("no launcher: never again after that", again === "seen" && p.pages.length === 1, again);
}

{
  const p = profile({ updater: true, running: "0.8.4", ready: null });
  const r = await p.show();
  check("an older launcher (answers with its update status): guide opens once", r === "shown" && p.pages.join() === PAGE, r);
}

{
  const p = profile({ registered: false, isDefault: false, portable: false });
  let r = await p.show();
  check("not registered yet (first start after a self-update): no page, nothing stored", r === "unavailable" && !p.pages.length && !(SEEN in p.data), r);
  p.reply = { registered: true, isDefault: false, portable: false };
  r = await p.show();
  check("registered on a later start: the guide opens then", r === "shown" && p.pages.join() === PAGE, r);
}

{
  const p = profile({ registered: true, isDefault: false, portable: true });
  const r = await p.show();
  check("a portable copy: guide opens once (no Windows default button in the page)", r === "shown" && p.pages.join() === PAGE && SEEN in p.data, r);
}

{
  const p = profile({ registered: true, isDefault: false, portable: false });
  const first = await p.show();
  const again = [await p.show(), await p.show()];
  check("registered and not the default: the guide opens once", first === "shown" && p.pages.length === 1 && p.pages[0] === "welcome.html", `${first}, ${p.pages.join()}`);
  check("never again in that profile, whatever the answer", again.every((r) => r === "seen") && p.pages.length === 1, again.join());
  check("the launcher is asked nothing after that", p.messages.length === 1 && p.messages[0] === "default-status", p.messages.join());
}

{
  const p = profile({ registered: true, isDefault: false, portable: false });
  const r = await Promise.all([p.show(), p.show(), p.show()]);
  check("onInstalled and onStartup on the same start: one page (they share one run)", p.pages.length === 1 && p.messages.length === 1, `${r.join()}; ${p.pages.length} page(s)`);
}

{
  const p = profile({ registered: true, isDefault: true, portable: false });
  const r = await p.show();
  p.reply = { registered: true, isDefault: false, portable: false };
  const later = await p.show();
  check("already the default: guide still opens once (AI + Shield steps), never again", r === "shown" && later === "seen" && p.pages.length === 1, `${r}, ${later}`);
}

{
  const p = profile({ registered: true, isDefault: false, portable: false });
  p.openPage = async () => { throw new Error("tabs.create failed"); };
  p.show = welcomeOnce(p);
  let error = null;
  try { await p.show(); } catch (e) { error = e.message; }
  const again = await p.show();
  check("stored before the page opens: a failure never shows it twice", error && SEEN in p.data && again === "seen", `${error}, ${again}`);
}

{
  const status = await defaultStatus(async () => ({ error: "boom" }));
  const opened = await openDefaultApps(async (m) => (m.type === "open-default-apps" ? { opened: true } : null));
  const refused = await openDefaultApps(async () => ({ opened: false }));
  const none = await openDefaultApps(async () => null);
  check("launcher errors read as unknown; Settings opened only when the launcher says so", status === null && opened && !refused && !none);
}

// ---- page markup: Ink layout + Helm copy rules
{
  const html = readFileSync(path.join(root, "shield", "welcome.html"), "utf8");
  const js = readFileSync(path.join(root, "shield", "welcome.js"), "utf8");
  const manifestCmd = readFileSync(path.join(root, "extension", "manifest.config.ts"), "utf8");
  const settings = readFileSync(path.join(root, "extension", "src", "lib", "settings.ts"), "utf8");

  check("welcome.html is pt-BR and loads welcome.js", /lang="pt-BR"/.test(html) && /src="welcome\.js"/.test(html));
  check("welcome.html has the three steps (Boas-vindas, IA, Shield)", /id="step-default"/.test(html) && /Bem-vindo ao Enki/.test(html) && /id="step-ai"/.test(html) && /Configure o assistente/.test(html) && /id="step-shield"/.test(html) && /Proteção ligada/.test(html));
  check("skip reads Pular guia and finishes the whole flow", /id="skip"/.test(html) && /Pular guia/.test(html) && /\$\("skip"\)\.addEventListener\("click", finish\)/.test(js) && /window\.close\(\)/.test(js));
  check("Agora não only advances to the next step", /id="default-next"/.test(html) && /Agora não/.test(html) && /\$\("default-next"\)\.addEventListener\("click", next\)/.test(js));
  check("step 1 primary is Tornar padrão (openDefaultApps)", /Tornar padrão/.test(html) && /openDefaultApps\(native\)/.test(js));
  check("step 2 uses Open Enki, Abrir Settings › Model, Get a key, Settings › About", /Open Enki/.test(html) && /Abrir Settings › Model/.test(js) && /Get a key →/.test(html) && /Settings › About/.test(html));
  check("step 2 Nemotron (NVIDIA · free) or Ollama; no OmniRoute", /chave grátis do Nemotron/.test(html) && /NVIDIA \(Nemotron\) · free/.test(html) && /Ollama \(local\)/.test(html) && !/OmniRoute/i.test(html));
  check("Get a key → points at future docs/AI-SETUP.md on main", /Get a key →/.test(html) && /danilogiles\/enki-browser\/blob\/main\/docs\/AI-SETUP\.md/.test(html));
  check("manifest open-panel is Ctrl+Shift+E / Command+Shift+E", /"open-panel"/.test(manifestCmd) && /Ctrl\+Shift\+E/.test(manifestCmd) && /Command\+Shift\+E/.test(manifestCmd));
  check("toolbar button title is Open Enki", /default_title:\s*"Open Enki"/.test(manifestCmd));
  check("welcome.js shows only the shortcut for this OS (Win/Linux vs Mac)", /isMac\(/.test(js) && /panelShortcutParts/.test(js) && /"Cmd"/.test(js) && /"Ctrl"/.test(js));
  {
    // Exact Provider menu names (Ink's 02-ia mock), each one a preset label in settings.ts.
    const names = ["Anthropic (Claude)", "OpenAI", "Google Gemini", "Groq", "OpenRouter"];
    const line = html.match(/id="other-providers">[\s\S]*?<strong>([^<]*)<\/strong>/)?.[1] ?? "";
    const listed = line.replace(/…$/, "").split(", ");
    const labels = [...settings.matchAll(/^\s*label:\s*"([^"]+)"/gm)].map((m) => m[1]);
    check("other-providers uses the exact Provider menu names", JSON.stringify(listed) === JSON.stringify(names), line);
    check("each other-provider name is a preset label in settings.ts", listed.length > 0 && listed.every((n) => labels.includes(n)), `missing: ${listed.filter((n) => !labels.includes(n)).join(", ") || "none"}`);
  }
  {
    // Helm 2026-10-08: Open Enki first, the shortcut second, with the chrome://extensions/shortcuts fallback.
    const ai = html.match(/<div id="step-ai"[\s\S]*?<\/p>/)?.[0] ?? "";
    const button = ai.indexOf("Open Enki");
    const keys = ai.indexOf('id="shortcut-keys"');
    check("step 2 offers Open Enki before the shortcut", button > 0 && keys > button, `Open Enki @${button}, shortcut @${keys}`);
    check("step 2 shortcut fallback: Se não abrir … chrome://extensions/shortcuts (as text)", /Se não abrir, use <span class="keys" id="shortcut-keys">/.test(ai) && /ou configure em <code[^>]*>chrome:\/\/extensions\/shortcuts<\/code>/.test(ai) && !/href="chrome:/.test(html));
  }
  check("Abrir Settings › Model opens ?view=settings on the Enki panel", /other-providers/.test(html) && /openAiSettings/.test(js) && /view=settings/.test(js) && /caelfocbikejgdamghjlkpmbbaobehlp/.test(js));
  const app = readFileSync(path.join(root, "extension", "src", "sidepanel", "App.tsx"), "utf8");
  check("App.tsx honours ?view=settings (Settings tab; Model is default)", /PAGE_OPEN_SETTINGS/.test(app) && /get\("view"\) === "settings"/.test(app));
  check("step 3 Shield chips match the mock", /Trackers bloqueados/.test(html) && /Anúncios bloqueados/.test(html));
  check("0.8.6 import step is a commented placeholder only", /0\.8\.6/.test(js) && /Importar favoritos/.test(js) && !/id="step-import"/.test(html));
  check("Ink mock tokens: accent #38bdf8, panel #1e1e1e, buddy logo", /#38bdf8/.test(html) && /#1e1e1e/.test(html) && /icons\/buddy\.svg/.test(html));
  {
    // Everyone gets the guide once: Portuguese is the page's own wording, and every marked text
    // has its English and Spanish; every text the script writes exists in all three.
    const pageKeys = [...html.matchAll(/data-i18n(?:-html|-aria)?="(\w+)"/g)].map((m) => m[1]);
    const pageTable = js.slice(js.indexOf("const PAGE_TEXT"), js.indexOf("const TEXT"));
    const missing = pageKeys.filter((k) => (pageTable.match(new RegExp(`^\\s+${k}:`, "gm")) ?? []).length !== 2);
    check("every marked text in the guide has English and Spanish", pageKeys.length >= 14 && missing.length === 0, `${pageKeys.length} marked; missing: ${missing.join(", ") || "none"}`);
    const textTable = js.slice(js.indexOf("const TEXT"), js.indexOf("const t = TEXT"));
    const keys = [...textTable.slice(0, textTable.indexOf("en: {")).matchAll(/^\s+(\w+):/gm)].map((m) => m[1]).filter((k) => k !== "pt");
    const partial = keys.filter((k) => (textTable.match(new RegExp(`^\\s+${k}:`, "gm")) ?? []).length !== 3);
    check("every text the guide's script writes exists in Portuguese, English and Spanish", keys.length >= 10 && partial.length === 0, `${keys.length} texts; incomplete: ${partial.join(", ") || "none"}`);
    check("the guide picks its language from the browser and translates before it shows", /navigator\.language/.test(js) && /translatePage\(\);\s*\n\s*status = await defaultStatus/.test(js));
  }
}

// ---- wiring: no new permission, Chromium's own bar still off, background and About reopen
{
  const manifest = JSON.parse(readFileSync(path.join(root, "shield", "manifest.json"), "utf8"));
  const expected = ["declarativeNetRequest", "webNavigation", "webRequest", "tabs", "storage", "alarms", "contentSettings", "browsingData", "nativeMessaging"];
  check("Enki Shield asks for no new permission", JSON.stringify(manifest.permissions) === JSON.stringify(expected) && !manifest.optional_permissions, manifest.permissions.join(", "));
  const flags = readFileSync(path.join(root, "config", "flags.txt"), "utf8");
  check("Chromium's default browser bar stays off (--no-default-browser-check)", /^--no-default-browser-check\s*$/m.test(flags));
  const bg = readFileSync(path.join(root, "shield", "background.js"), "utf8");
  check("the background script offers the guide on install and on start", /welcomeOnce\(/.test(bg) && /onStartup\.addListener\(offerDefault\)/.test(bg) && /onInstalled\.addListener\(offerDefault\)/.test(bg));
  const optionsHtml = readFileSync(path.join(root, "shield", "options.html"), "utf8");
  const optionsJs = readFileSync(path.join(root, "shield", "options.js"), "utf8");
  check("Shield settings has Ver o guia de novo under Enki Browser", /id="show-guide"/.test(optionsHtml) && /Ver o guia de novo/.test(optionsHtml));
  const about = readFileSync(path.join(root, "extension", "src", "sidepanel", "SettingsView.tsx"), "utf8");
  check("Settings › About has Ver o guia de novo (opens Shield welcome)", /Section title="About"/.test(about) && /Ver o guia de novo/.test(about) && /aacambieennepbgemjkpailjdkldbjjf\/welcome\.html/.test(about));
  check("Ver o guia de novo reopens welcome.html without clearing SEEN", /show-guide/.test(optionsJs) && /welcome\.html/.test(optionsJs) && !new RegExp(`remove.*${SEEN}|${SEEN}.*false`).test(optionsJs));
  check("Settings › About has Check for updates (opens Shield settings at #check-updates)", /Check for updates/.test(about) && /aacambieennepbgemjkpailjdkldbjjf\/options\.html#check-updates/.test(about));
  check("Shield settings start the check when opened at #check-updates", /location\.hash === "#check-updates"/.test(optionsJs) && /checkUpdates\.click\(\)/.test(optionsJs));
  check("after a check the page says it checked just now", /Checked just now · \$\{latest\} is the latest\./.test(optionsJs));
  const popupJs = readFileSync(path.join(root, "shield", "popup.js"), "utf8");
  check("the Shields popup's Check for updates link starts the check", /options\.html#check-updates/.test(popupJs));
  check("buddy.svg ships with the guide", (() => { try { readFileSync(path.join(root, "shield", "icons", "buddy.svg")); return true; } catch { return false; } })());
}

{
  const welcomeJs = readFileSync(path.join(root, "shield", "welcome.js"), "utf8");
  const defJs = readFileSync(path.join(root, "shield", "default-browser.js"), "utf8");
  check("guide modules make zero network calls", !/\bfetch\s*\(/.test(welcomeJs) && !/\bfetch\s*\(/.test(defJs) && !/\bXMLHttpRequest\b/.test(welcomeJs));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
