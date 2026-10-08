// First-run guide (default-browser.js decides when it opens once).
// Steps match Ink's 0.8.5 onboarding mocks: default → (0.8.6: import) → AI → Shield.
import { defaultStatus, openDefaultApps } from "./default-browser.js";
import { native } from "./updates.js";

const $ = (id) => document.getElementById(id);

/** Ordered step ids. 0.8.6 inserts "import" between "default" and "ai". */
const STEPS = [
  "default",
  // 0.8.6: "import" — Importar favoritos do Chrome, Edge e Brave (senhas só via CSV /
  // importador nativo do Firefox; desmarcadas por padrão). Leave this comment; don't build yet.
  "ai",
  "shield",
];

/** Fixed Enki assistant id (config/initial_preferences.json, enki-extension.pub). */
const ENKI_ID = "caelfocbikejgdamghjlkpmbbaobehlp";

let index = 0;
let status = null;

/** True on macOS (Enki ships macOS builds). navigator.userAgentData when present. */
function isMac() {
  const p = navigator.userAgentData?.platform;
  if (typeof p === "string" && p) return /mac/i.test(p);
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || "") || /Mac OS X/.test(navigator.userAgent || "");
}

function panelShortcutParts() {
  // extension/manifest.config.ts → commands["open-panel"]: Ctrl+Shift+E / Command+Shift+E
  return isMac() ? ["Cmd", "Shift", "E"] : ["Ctrl", "Shift", "E"];
}

function paintShortcut() {
  const host = $("shortcut-keys");
  if (!host) return;
  const parts = panelShortcutParts();
  host.replaceChildren(...parts.flatMap((part, i) => {
    const nodes = [];
    if (i) nodes.push(document.createTextNode("+"));
    const k = document.createElement("kbd");
    k.textContent = part;
    nodes.push(k);
    return nodes;
  }));
}

function openAiSettings() {
  // Opens the Enki side-panel document at Settings › Model (?view=settings; Model is the default tab).
  chrome.tabs.create({ url: `chrome-extension://${ENKI_ID}/src/sidepanel/index.html?view=settings` });
}

function paintProgress() {
  const n = STEPS.length;
  $("count").textContent = `${index + 1}/${n}`;
  $("pips").replaceChildren(...STEPS.map((_, i) => {
    const s = document.createElement("span");
    if (i < index) s.className = "done";
    if (i === index) s.setAttribute("aria-current", "step");
    return s;
  }));
}

function paintDefault() {
  const lead = $("default-lead");
  const primary = $("primary");
  const next = $("default-next");
  const state = $("state");
  state.textContent = "";
  const canAsk = status?.registered === true && !status.portable;

  if (canAsk && status.isDefault) {
    lead.textContent = "O Enki já é o seu navegador padrão. Links de outros apps abrem aqui, com o Shield ligado.";
    primary.textContent = "Continuar";
    primary.hidden = false;
    next.hidden = true;
    return;
  }
  if (canAsk) {
    lead.textContent = "O Enki é um navegador privado com assistente de IA. Quer torná-lo o navegador padrão?";
    primary.textContent = "Tornar padrão";
    primary.hidden = false;
    next.hidden = false;
    next.textContent = "Agora não";
    return;
  }
  // Linux, macOS, portable, or no launcher: welcome only.
  lead.textContent = "O Enki é um navegador privado com assistente de IA. Em dois passos: configure o assistente e veja o que o Shield protege.";
  primary.textContent = "Continuar";
  primary.hidden = false;
  next.hidden = true;
}

function paintAi() {
  paintShortcut();
}

function paintFoot() {
  const primary = $("primary");
  const next = $("default-next");
  const step = STEPS[index];
  if (step === "default") {
    paintDefault();
    return;
  }
  next.hidden = true;
  primary.hidden = false;
  if (step === "ai") {
    paintAi();
    primary.textContent = "Abrir Settings › Model";
    return;
  }
  // shield
  primary.textContent = "Começar";
}

function show(i) {
  index = Math.max(0, Math.min(i, STEPS.length - 1));
  for (const id of STEPS) {
    const el = $(`step-${id}`);
    if (el) el.hidden = id !== STEPS[index];
  }
  // Keep one h1 labelled for the dialog.
  const title = document.querySelector(`#step-${STEPS[index]} h1`);
  if (title) title.id = "title";
  for (const h of document.querySelectorAll(".card-body h1")) {
    if (h !== title) h.removeAttribute("id");
  }
  paintProgress();
  paintFoot();
  const focus = document.querySelector(".card-foot .btn-primary:not([hidden]), .card-foot .btn-secondary:not([hidden])");
  focus?.focus();
}

function next() {
  if (index >= STEPS.length - 1) {
    window.close();
    return;
  }
  show(index + 1);
}

function finish() {
  window.close();
}

async function onPrimary() {
  const step = STEPS[index];
  if (step === "default") {
    const canAsk = status?.registered === true && !status.portable && !status.isDefault;
    if (canAsk) {
      $("state").textContent = (await openDefaultApps(native))
        ? "Em Configurações, escolha Enki Browser e “Definir como padrão” (no Windows 10: Navegador da Web → Enki Browser)."
        : "Não foi possível abrir as Configurações. Abra Configurações → Aplicativos → Aplicativos padrão e escolha Enki Browser.";
      return; // stay on step 1 so they can Agora não / Continuar after Settings
    }
    next();
    return;
  }
  if (step === "ai") {
    openAiSettings();
    next();
    return;
  }
  finish();
}

$("primary").addEventListener("click", () => void onPrimary());
$("default-next").addEventListener("click", next); // Agora não → next step only
$("skip").addEventListener("click", finish); // Pular guia → close whole flow
$("other-providers").addEventListener("click", () => { openAiSettings(); });

window.addEventListener("focus", async () => {
  if (STEPS[index] !== "default") return;
  status = await defaultStatus(native);
  paintDefault();
});

status = await defaultStatus(native);
paintShortcut();
show(0);
document.documentElement.dataset.ready = "true";
