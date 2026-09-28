// The warning shown instead of a known phishing site. It never loads the site itself; the only
// way through is the explicit "continue" button, which allows that one host for this session.
const TEXT = {
  pt: {
    doc: "Site perigoso bloqueado",
    title: "Site perigoso bloqueado",
    lead: "O Enki Shield impediu a abertura desta página. Ela aparece numa lista pública de phishing: sites que imitam bancos, lojas e serviços para roubar senhas e dados de cartão.",
    test: "Este é o endereço de teste do Enki Shield: ele é sempre bloqueado, para você ver o aviso sem visitar um site perigoso.",
    back: "Voltar para a segurança",
    proceed: "Entendo o risco, abrir mesmo assim",
    whyTitle: "Por que isto foi bloqueado?",
    why: "A lista é baixada para o seu computador e toda a verificação acontece aqui: os sites que você visita nunca são enviados a ninguém.",
    list: (d, p, when) => `Lista: phishing-filter (OpenPhish, PhishTank e IPThreat), CC BY-SA 4.0. ${d.toLocaleString("pt-BR")} domínios e ${p.toLocaleString("pt-BR")} páginas, atualizada ${when}.`,
    never: "ainda não baixada",
    report: "Não é phishing? Reporte um falso positivo",
  },
  es: {
    doc: "Sitio peligroso bloqueado",
    title: "Sitio peligroso bloqueado",
    lead: "Enki Shield impidió abrir esta página. Aparece en una lista pública de phishing: sitios que imitan bancos, tiendas y servicios para robar contraseñas y datos de tarjetas.",
    test: "Esta es la dirección de prueba de Enki Shield: siempre se bloquea, para que veas el aviso sin visitar un sitio peligroso.",
    back: "Volver a un lugar seguro",
    proceed: "Entiendo el riesgo, abrir de todos modos",
    whyTitle: "¿Por qué se bloqueó?",
    why: "La lista se descarga en tu equipo y toda la comprobación ocurre aquí: los sitios que visitas nunca se envían a nadie.",
    list: (d, p, when) => `Lista: phishing-filter (OpenPhish, PhishTank e IPThreat), CC BY-SA 4.0. ${d.toLocaleString("es")} dominios y ${p.toLocaleString("es")} páginas, actualizada ${when}.`,
    never: "aún no descargada",
    report: "¿No es phishing? Informa de un falso positivo",
  },
  en: {
    doc: "Dangerous site blocked",
    title: "Dangerous site blocked",
    lead: "Enki Shield stopped this page from opening. It is on a public phishing list: sites that imitate banks, shops and services to steal passwords and card details.",
    test: "This is Enki Shield's test address: it is always blocked, so you can see the warning without visiting a dangerous site.",
    back: "Back to safety",
    proceed: "I understand the risk, open it anyway",
    whyTitle: "Why was this blocked?",
    why: "The list is downloaded to your computer and every check happens here: the sites you visit are never sent to anyone.",
    list: (d, p, when) => `List: phishing-filter (OpenPhish, PhishTank and IPThreat), CC BY-SA 4.0. ${d.toLocaleString("en")} domains and ${p.toLocaleString("en")} pages, updated ${when}.`,
    never: "not downloaded yet",
    report: "Not phishing? Report a false positive",
  },
};
const lang = navigator.language.startsWith("pt") ? "pt" : navigator.language.startsWith("es") ? "es" : "en";
const t = TEXT[lang];
const url = new URLSearchParams(location.search).get("url") ?? "";
let host = "";
try { host = new URL(url).hostname; } catch { /* malformed: nothing to allow */ }
const isTest = host === "enki-shield.invalid" || host.endsWith(".enki-shield.invalid");

document.documentElement.lang = lang;
document.title = t.doc;
for (const id of ["title", "back", "proceed", "whyTitle", "why", "report"]) document.getElementById(id).textContent = t[id];
document.getElementById("lead").textContent = isTest ? t.test : t.lead;
document.getElementById("host").textContent = host || url;

chrome.runtime.sendMessage({ type: "shield:status" }).then((s) => {
  if (!s) return;
  const when = s.updatedAt ? new Date(s.updatedAt).toLocaleString(navigator.language) : t.never;
  document.getElementById("list").textContent = t.list(s.domains, s.pages, when);
});

document.getElementById("back").addEventListener("click", () => {
  // Not history.back(): the entry before this one is the refused navigation, and going back to
  // it would land on this warning again. A new tab is safe by construction.
  chrome.tabs.getCurrent().then((tab) => chrome.tabs.update(tab.id, { url: "chrome://newtab/" }));
});

const proceed = document.getElementById("proceed");
// Shown for the test address too: allowing it ends on "address not found" (.invalid never
// resolves), which proves the way through works without going near a real phishing site.
if (!host) proceed.hidden = true;
proceed.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "shield:allow", host });
  location.replace(url);
});
document.getElementById("back").focus();
