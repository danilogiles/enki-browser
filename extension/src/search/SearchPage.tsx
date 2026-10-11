import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import logo from "../assets/logo.svg";
import { createProvider } from "../lib/providers";
import { loadSettings, presetOf, type Settings } from "../lib/settings";
import { safeMarkdownProps } from "../lib/safe-markdown";
import { buildSearchRequest, ddgUrl, decideRoute, getSearchEngine, isFallbackError, parseQuery } from "../lib/search";

type Source = { url: string; title?: string };
type State = { phase: "idle" | "streaming" | "done" | "error"; text: string; sources: Source[]; error?: string };

export function hasModel(s: Settings): boolean {
  const model = (s.askModel || s.model).trim();
  return !!model && (!!s.apiKey || !!presetOf(s.preset).keyOptional);
}

/** The chip's short provider name: "Claude" for Anthropic, otherwise the label without its note. */
function providerName(s: Settings): string {
  if (s.preset === "anthropic") return "Claude";
  return presetOf(s.preset).label.replace(/\s*\(.*\)\s*$/, "");
}

const settingsUrl = () => chrome.runtime.getURL("src/sidepanel/index.html?view=settings");

export function SearchPage() {
  const initial = new URLSearchParams(location.search).get("q") ?? "";
  const [query, setQuery] = useState(parseQuery(initial).query);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [state, setState] = useState<State>({ phase: "idle", text: "", sources: [] });
  const abort = useRef<AbortController | null>(null);

  const run = async (raw: string) => {
    const { query: q, force } = parseQuery(raw);
    const s = await loadSettings();
    setSettings(s);
    // A query edited on this page is routed again, the same way the early script did.
    const route = decideRoute({
      engine: await getSearchEngine(),
      force,
      incognito: !!chrome.extension?.inIncognitoContext,
      hasModel: hasModel(s),
      query: q,
    });
    if (route === "ddg") {
      location.replace(ddgUrl(q));
      return;
    }
    document.title = q;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setState({ phase: "streaming", text: "", sources: [] });
    try {
      const req = buildSearchRequest(s.askModel || s.model, q, s.maxOutputTokens, ctl.signal);
      for await (const ev of createProvider(s).stream(req)) {
        if (ev.type === "text_delta") setState((p) => ({ ...p, text: p.text + ev.text }));
        else if (ev.type === "source")
          setState((p) => (p.sources.some((x) => x.url === ev.url) ? p : { ...p, sources: [...p.sources, { url: ev.url, title: ev.title }] }));
      }
      setState((p) => ({ ...p, phase: "done" }));
    } catch (e) {
      if (ctl.signal.aborted) return;
      const message = e instanceof Error ? e.message : String(e);
      setState((p) => ({ ...p, phase: "error", error: isFallbackError(message) ? "Your AI provider refused the request (key or rate limit)." : "Your AI provider could not answer." }));
    }
  };

  useEffect(() => {
    void run(initial);
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(location.href);
    url.search = new URLSearchParams({ q: query }).toString(); // only q, never other params
    history.replaceState(null, "", url.toString());
    void run(query);
  };

  if (!settings) return null;
  const ddg = ddgUrl(parseQuery(query).query);
  return (
    <div className="wrap">
      <header className="top">
        <img src={logo} alt="Enki" />
        <form onSubmit={submit} className="qform">
          <input className="q" aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </form>
        <span className="chip">{providerName(settings)} · Ask</span>
        <nav className="links">
          <a href={ddg} rel="noopener noreferrer">Search on DuckDuckGo</a>
          <a href={settingsUrl()} onClick={(e) => { e.preventDefault(); void chrome.tabs.create({ url: settingsUrl() }); }}>Change search engine</a>
        </nav>
      </header>
      <main className="ans" aria-live="polite">
        <Markdown remarkPlugins={[remarkGfm]} {...safeMarkdownProps}>{state.text}</Markdown>
        {state.phase === "streaming" && <span className="cur" aria-hidden />}
        {state.phase === "error" && (
          <p className="notice" role="alert">
            {state.error} <a href={ddg} rel="noopener noreferrer">Search on DuckDuckGo instead</a>
          </p>
        )}
      </main>
      <footer className="foot">
        {state.sources.length ? (
          <>
            <div className="foot-title">Sources</div>
            <div className="src">
              {state.sources.map((s, i) => (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" title={s.title ?? s.url}>
                  {i + 1} · {hostOf(s.url)}
                </a>
              ))}
            </div>
            <div className="muted">Your query may be shared with your provider's search partner.</div>
          </>
        ) : (
          <div className="muted">Answer from your model only, not verified search results</div>
        )}
      </footer>
    </div>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
