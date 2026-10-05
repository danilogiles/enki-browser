import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Globe, MessageCircle, MousePointerClick, ShieldCheck } from "lucide-react";
import logo from "../assets/logo.svg";
import { putHandoff } from "../lib/handoff";
import { legalLinks } from "../lib/legal";
import { loadSettings, presetOf, type Settings } from "../lib/settings";
import { customTokens, luminance } from "../lib/theme";

/**
 * Enki Home: the new tab page of Enki Browser. One box that either asks Enki — the side panel
 * opens with the request already sent — or searches the web. The extension ships this page, but
 * only Enki Browser turns it on (its build adds the new-tab override to the manifest), so people
 * who install the extension in their own browser keep their new tab page.
 */

type Mode = "ask" | "act";
type Lang = "pt" | "es" | "en";

const TEXT = {
  pt: {
    tab: "Nova guia",
    greeting: ["Boa noite", "Bom dia", "Boa tarde", "Boa noite"],
    placeholder: "Pergunte qualquer coisa ou peça para o Enki fazer por você",
    ask: "Perguntar",
    act: "Agir",
    askHint: "Responde com base na web e na página",
    actHint: "Navega, clica e digita por você",
    send: "Enviar ao Enki",
    search: "Pesquisar na web",
    keys: "Enter envia ao Enki · Alt+Enter pesquisa no DuckDuckGo",
    suggestions: [
      { text: "Quais são as principais notícias de hoje?", mode: "act" },
      { text: "Compare o preço de um fone com cancelamento de ruído em 3 lojas", mode: "act" },
      { text: "Explique computação quântica em três frases", mode: "ask" },
      { text: "Monte um roteiro de 3 dias em Lisboa", mode: "ask" },
    ],
    privacy: ["Rastreadores bloqueados", "Busca DuckDuckGo", "Sem telemetria"],
    model: "Modelo",
    setup: "Escolher modelo",
  },
  es: {
    tab: "Nueva pestaña",
    greeting: ["Buenas noches", "Buenos días", "Buenas tardes", "Buenas noches"],
    placeholder: "Pregunta lo que quieras o pídele a Enki que lo haga por ti",
    ask: "Preguntar",
    act: "Actuar",
    askHint: "Responde con la web y la página",
    actHint: "Navega, hace clic y escribe por ti",
    send: "Enviar a Enki",
    search: "Buscar en la web",
    keys: "Enter envía a Enki · Alt+Enter busca en DuckDuckGo",
    suggestions: [
      { text: "¿Cuáles son las noticias principales de hoy?", mode: "act" },
      { text: "Compara el precio de unos auriculares con cancelación de ruido en 3 tiendas", mode: "act" },
      { text: "Explica la computación cuántica en tres frases", mode: "ask" },
      { text: "Planifica un viaje de 3 días a Lisboa", mode: "ask" },
    ],
    privacy: ["Rastreadores bloqueados", "Búsqueda DuckDuckGo", "Sin telemetría"],
    model: "Modelo",
    setup: "Elegir modelo",
  },
  en: {
    tab: "New Tab",
    greeting: ["Good evening", "Good morning", "Good afternoon", "Good evening"],
    placeholder: "Ask anything, or ask Enki to do it for you",
    ask: "Ask",
    act: "Act",
    askHint: "Answers from the web and the page",
    actHint: "Navigates, clicks and types for you",
    send: "Send to Enki",
    search: "Search the web",
    keys: "Enter sends to Enki · Alt+Enter searches DuckDuckGo",
    suggestions: [
      { text: "What are today's top news stories?", mode: "act" },
      { text: "Compare the price of noise-cancelling headphones at 3 stores", mode: "act" },
      { text: "Explain quantum computing in three sentences", mode: "ask" },
      { text: "Plan a 3-day trip to Lisbon", mode: "ask" },
    ],
    privacy: ["Trackers blocked", "DuckDuckGo search", "No telemetry"],
    model: "Model",
    setup: "Choose a model",
  },
} as const satisfies Record<Lang, unknown>;

const lang: Lang = navigator.language.startsWith("pt") ? "pt" : navigator.language.startsWith("es") ? "es" : "en";
const t = TEXT[lang];

/** Something that is plainly an address, not a question: go there instead of asking about it. */
function asUrl(input: string): string | null {
  const s = input.trim();
  if (/\s/.test(s) || !s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s) ? `https://${s}` : null;
}

export function Home() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("ask");
  const [settings, setSettings] = useState<Settings | null>(null);
  // sidePanel.open must run inside the click, before any await, so the window is known up front.
  const windowId = useRef<number | undefined>(undefined);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.title = t.tab;
    document.documentElement.lang = lang;
    void chrome.windows.getCurrent().then((w) => { windowId.current = w.id; });
    void loadSettings().then((s) => { setSettings(s); applyHomeTheme(s); });
    void chrome.storage.local.get("enki:mode").then((s) => { if (s["enki:mode"] === "act") setMode("act"); });
  }, []);

  const openPanel = () => {
    if (windowId.current !== undefined) void chrome.sidePanel.open({ windowId: windowId.current });
  };

  const askEnki = (request: string, m: Mode) => {
    const q = request.trim();
    if (!q) return;
    openPanel();
    void putHandoff(q, m);
    setText("");
  };

  const searchWeb = (request: string) => {
    const q = request.trim();
    if (!q) return;
    location.href = asUrl(q) ?? `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (asUrl(text)) return searchWeb(text);
    askEnki(text, mode);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (e.altKey) searchWeb(text);
    else submit();
  };

  const configured = !!settings && (!!settings.apiKey || !!presetOf(settings.preset).keyOptional);
  const greeting = t.greeting[Math.floor(new Date().getHours() / 6)];

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between px-6 py-4 text-sm">
        <div className="flex items-center gap-2 text-mist/90">
          <img src={logo} alt="" className="h-6 w-6 rounded-md" />
          <span className="font-semibold tracking-tight">Enki</span>
        </div>
        <button
          type="button"
          onClick={openPanel}
          title={configured ? `${t.model}: ${settings?.model}` : t.setup}
          className="max-w-[16rem] truncate rounded-full border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-muted transition hover:border-sky/40 hover:text-mist"
        >
          {configured ? settings?.model : t.setup}
        </button>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-5 pb-24">
        <img src={logo} alt="" className="rise mb-5 h-14 w-14 rounded-2xl shadow-[0_8px_40px_rgb(56_189_248/0.25)]" />
        <h1 className="rise mb-8 text-center text-3xl font-semibold tracking-tight text-mist sm:text-4xl" style={{ animationDelay: "40ms" }}>
          {greeting}
        </h1>

        <form
          onSubmit={submit}
          className="rise w-full rounded-3xl border border-fg/10 bg-fg/[0.06] p-3 shadow-[0_12px_40px_rgb(0_0_0/0.14)] backdrop-blur transition focus-within:border-sky/50 focus-within:bg-fg/[0.08]"
          style={{ animationDelay: "80ms" }}
        >
          <textarea
            ref={input}
            autoFocus
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={t.placeholder}
            aria-label={t.placeholder}
            className="block w-full resize-none bg-transparent px-2 pt-1 text-lg leading-relaxed text-mist outline-none placeholder:text-muted/70 focus-visible:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <div role="radiogroup" aria-label={`${t.ask} / ${t.act}`} className="flex rounded-full bg-fg/[0.06] p-0.5 text-sm">
              {([["ask", t.ask, t.askHint, MessageCircle], ["act", t.act, t.actHint, MousePointerClick]] as const).map(([m, label, hint, Icon]) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  title={hint}
                  onClick={() => { setMode(m); input.current?.focus(); }}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition ${mode === m ? "bg-sky/20 text-mist" : "text-muted hover:text-mist"}`}
                >
                  <Icon size={15} aria-hidden />
                  {label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => searchWeb(text)}
                disabled={!text.trim()}
                title={t.search}
                aria-label={t.search}
                className="rounded-full p-2 text-muted transition hover:bg-fg/10 hover:text-mist disabled:opacity-40"
              >
                <Globe size={18} aria-hidden />
              </button>
              <button
                type="submit"
                disabled={!text.trim()}
                title={t.send}
                aria-label={t.send}
                className="rounded-full bg-sky p-2 text-deep transition hover:bg-sky/85 disabled:bg-fg/10 disabled:text-muted"
              >
                <ArrowUp size={18} strokeWidth={2.5} aria-hidden />
              </button>
            </div>
          </div>
        </form>
        <p className="rise mt-3 text-xs text-muted/80" style={{ animationDelay: "120ms" }}>{t.keys}</p>

        <ul className="rise mt-8 grid w-full gap-2 sm:grid-cols-2" style={{ animationDelay: "160ms" }}>
          {t.suggestions.map((s) => (
            <li key={s.text}>
              <button
                type="button"
                onClick={() => { setMode(s.mode); askEnki(s.text, s.mode); }}
                className="group flex w-full items-start gap-2.5 rounded-2xl border border-fg/[0.07] bg-fg/[0.03] px-4 py-3 text-left text-sm text-mist/85 transition hover:border-sky/30 hover:bg-fg/[0.06] hover:text-mist"
              >
                {s.mode === "act"
                  ? <MousePointerClick size={16} className="mt-0.5 shrink-0 text-sky/80" aria-hidden />
                  : <MessageCircle size={16} className="mt-0.5 shrink-0 text-sky/80" aria-hidden />}
                <span>{s.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </main>

      <footer className="flex items-center justify-center gap-2 px-6 pb-6 text-xs text-muted/80">
        <ShieldCheck size={14} className="text-sky/80" aria-hidden />
        {t.privacy.join(" · ")}
        <span aria-hidden>·</span>
        <a className="underline-offset-2 hover:underline" href={legalLinks().terms} target="_blank" rel="noreferrer">Terms</a>
        <a className="underline-offset-2 hover:underline" href={legalLinks().privacy} target="_blank" rel="noreferrer">Privacy</a>
      </footer>
    </div>
  );
}

/**
 * Enki Home wears the panel's theme: Light and Dark are forced, the custom colours map onto the
 * page's variables, and everything else (System, and the dark named themes) follows the OS.
 */
function applyHomeTheme(s: Settings) {
  const root = document.documentElement;
  const theme = s.theme === "light" ? "light" : ["dark", "navy", "midnight", "nord", "cyberpunk"].includes(s.theme) ? "dark" : "system";
  root.setAttribute("data-theme", theme);
  if (s.theme === "custom" && s.customTheme) {
    const t = customTokens(s.customTheme);
    const dark = luminance(s.customTheme.background) < 0.4;
    const vars: Record<string, string> = {
      "--page": s.customTheme.background, "--text": s.customTheme.text, "--muted": t["--zinc-400"],
      "--accent": s.customTheme.accent, "--on-accent": dark ? "#0b1220" : "#ffffff",
      "--overlay": dark ? "#ffffff" : "#000000", "--glow": "transparent",
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.style.colorScheme = dark ? "dark" : "light";
  }
}
