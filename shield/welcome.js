// First-run guide (default-browser.js decides when it opens once).
// Steps match Ink's onboarding mocks: default → (next release: import) → AI → Shield.
import { defaultStatus, openDefaultApps } from "./default-browser.js";
import { native } from "./updates.js";

const $ = (id) => document.getElementById(id);

// The guide is written in Portuguese (welcome.html, Ink's mocks) and shown in the browser's
// language: Portuguese, Spanish, or English for everyone else. It opens once for every new user,
// so it must not greet most of them in a language they may not read.
const LANG = navigator.language?.startsWith("pt") ? "pt" : navigator.language?.startsWith("es") ? "es" : "en";

/** The page's own text (data-i18n: text, data-i18n-html: our markup, data-i18n-aria: a label). */
const PAGE_TEXT = {
  en: {
    eyebrow: "First run",
    progress: "Guide progress",
    welcomeTitle: "Welcome to Enki",
    aiTitle: "Set up the assistant",
    aiLead: 'To start, get a <strong>free Nemotron key</strong> (no card) or use <strong>Ollama</strong> on your computer. Open the panel with the <strong>Open Enki</strong> button. If it does not open, use <span class="keys" id="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd></span> or set it in <code class="shortcuts-url">chrome://extensions/shortcuts</code>.',
    nemotron: "Free key, no card · Provider <strong>NVIDIA (Nemotron) · free</strong>",
    needsKey: "Needs a key",
    ollama: "A model on your computer · <strong>Ollama (local)</strong>",
    otherProviders: 'Or use another provider: <strong>Anthropic (Claude), OpenAI, Google Gemini, Groq, OpenRouter…</strong> <span class="where">→</span>',
    shieldTitle: "Protection on",
    shieldLead: "Shield blocks trackers and ads by default. You can change that at any time.",
    trackers: '<span class="dot"></span>Trackers blocked',
    ads: '<span class="dot"></span>Ads blocked',
    skip: "Skip guide",
    notNow: "Not now",
    note: '<img src="icons/buddy.svg" alt="">You can open it again from Settings › About.',
  },
  es: {
    eyebrow: "Primer inicio",
    progress: "Progreso de la guía",
    welcomeTitle: "Bienvenido a Enki",
    aiTitle: "Configura el asistente",
    aiLead: 'Para empezar, consigue una <strong>clave gratuita de Nemotron</strong> (sin tarjeta) o usa <strong>Ollama</strong> en tu ordenador. Abre el panel con el botón <strong>Open Enki</strong>. Si no se abre, usa <span class="keys" id="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd></span> o configúralo en <code class="shortcuts-url">chrome://extensions/shortcuts</code>.',
    nemotron: "Clave gratuita, sin tarjeta · Proveedor <strong>NVIDIA (Nemotron) · free</strong>",
    needsKey: "Necesita clave",
    ollama: "Un modelo en tu ordenador · <strong>Ollama (local)</strong>",
    otherProviders: 'O usa otro proveedor: <strong>Anthropic (Claude), OpenAI, Google Gemini, Groq, OpenRouter…</strong> <span class="where">→</span>',
    shieldTitle: "Protección activada",
    shieldLead: "Shield bloquea rastreadores y anuncios por defecto. Puedes cambiarlo cuando quieras.",
    trackers: '<span class="dot"></span>Rastreadores bloqueados',
    ads: '<span class="dot"></span>Anuncios bloqueados',
    skip: "Saltar guía",
    notNow: "Ahora no",
    note: '<img src="icons/buddy.svg" alt="">Puedes volver a abrirla en Settings › About.',
  },
};

/** What the script writes, in each language; "pt" is the page's own wording. */
const TEXT = {
  pt: {
    alreadyDefault: "O Enki já é o seu navegador padrão. Links de outros apps abrem aqui, com o Shield ligado.",
    askDefault: "O Enki é um navegador privado com assistente de IA. Quer torná-lo o navegador padrão?",
    welcomeOnly: "O Enki é um navegador privado com assistente de IA. Em dois passos: configure o assistente e veja o que o Shield protege.",
    continue: "Continuar",
    makeDefault: "Tornar padrão",
    notNow: "Agora não",
    openModel: "Abrir Settings › Model",
    start: "Começar",
    settingsOpened: "Em Configurações, escolha Enki Browser e “Definir como padrão” (no Windows 10: Navegador da Web → Enki Browser).",
    settingsFailed: "Não foi possível abrir as Configurações. Abra Configurações → Aplicativos → Aplicativos padrão e escolha Enki Browser.",
  },
  en: {
    alreadyDefault: "Enki is already your default browser. Links from other apps open here, with Shield on.",
    askDefault: "Enki is a private browser with an AI assistant. Make it your default browser?",
    welcomeOnly: "Enki is a private browser with an AI assistant. Two steps: set up the assistant and see what Shield protects.",
    continue: "Continue",
    makeDefault: "Make default",
    notNow: "Not now",
    openModel: "Open Settings › Model",
    start: "Get started",
    settingsOpened: "In Settings, choose Enki Browser, then “Set default” (on Windows 10: Web browser → Enki Browser).",
    settingsFailed: "Settings could not be opened. Open Settings → Apps → Default apps and choose Enki Browser.",
  },
  es: {
    alreadyDefault: "Enki ya es tu navegador predeterminado. Los enlaces de otras apps se abren aquí, con Shield activado.",
    askDefault: "Enki es un navegador privado con asistente de IA. ¿Quieres que sea tu navegador predeterminado?",
    welcomeOnly: "Enki es un navegador privado con asistente de IA. En dos pasos: configura el asistente y mira lo que Shield protege.",
    continue: "Continuar",
    makeDefault: "Establecer como predeterminado",
    notNow: "Ahora no",
    openModel: "Abrir Settings › Model",
    start: "Empezar",
    settingsOpened: "En Configuración, elige Enki Browser y “Establecer como predeterminado” (en Windows 10: Explorador web → Enki Browser).",
    settingsFailed: "No se pudo abrir Configuración. Abre Configuración → Aplicaciones → Aplicaciones predeterminadas y elige Enki Browser.",
  },
};
const t = TEXT[LANG];

function translatePage() {
  if (LANG === "pt") return;
  document.documentElement.lang = LANG;
  const words = PAGE_TEXT[LANG];
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = words[el.dataset.i18n];
  for (const el of document.querySelectorAll("[data-i18n-html]")) el.innerHTML = words[el.dataset.i18nHtml];
  for (const el of document.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", words[el.dataset.i18nAria]);
}

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
    lead.textContent = t.alreadyDefault;
    primary.textContent = t.continue;
    primary.hidden = false;
    next.hidden = true;
    return;
  }
  if (canAsk) {
    lead.textContent = t.askDefault;
    primary.textContent = t.makeDefault;
    primary.hidden = false;
    next.hidden = false;
    next.textContent = t.notNow;
    return;
  }
  // Linux, macOS, portable, or no launcher: welcome only.
  lead.textContent = t.welcomeOnly;
  primary.textContent = t.continue;
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
    primary.textContent = t.openModel;
    return;
  }
  // shield
  primary.textContent = t.start;
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
        ? t.settingsOpened
        : t.settingsFailed;
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

translatePage();
status = await defaultStatus(native);
paintShortcut();
show(0);
document.documentElement.dataset.ready = "true";
