/**
 * The open web, for questions the current page cannot answer: news, results, prices, anything
 * that happened after the model was trained. Both tools only read, so they exist in Ask mode too.
 *
 * Search needs no key or account. Brave Search's results page is read first (independent index,
 * no tracking, and it answers a plain request); DuckDuckGo's HTML endpoint next. Both refuse
 * now and then with a challenge page, so the last resort is DuckDuckGo opened in a background
 * tab and read like any page — a real browser is never refused. Bing's RSS was tried and
 * dropped: it ignores the query's language and returned dictionary pages for news questions.
 */

export type SearchResult = { title: string; url: string; snippet: string };

const strip = (s: string) => s.replace(/\s+/g, " ").trim();

async function duckDuckGo(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { signal, credentials: "omit" });
  if (!res.ok) throw new Error(`DuckDuckGo answered ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  return [...doc.querySelectorAll(".result")].flatMap((r) => {
    const a = r.querySelector<HTMLAnchorElement>("a.result__a");
    if (!a) return [];
    // Result links go through DuckDuckGo's redirect; the real address is its uddg parameter.
    let url = a.getAttribute("href") ?? "";
    try {
      const u = new URL(url, "https://duckduckgo.com");
      url = u.searchParams.get("uddg") ?? u.href;
    } catch { /* keep as is */ }
    if (!/^https?:/.test(url) || /duckduckgo\.com\/y\.js/.test(url)) return []; // ads
    return [{ title: strip(a.textContent ?? ""), url, snippet: strip(r.querySelector(".result__snippet")?.textContent ?? "") }];
  });
}

async function brave(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch(`https://search.brave.com/search?q=${encodeURIComponent(query)}`, { signal, credentials: "omit" });
  if (!res.ok) throw new Error(`Brave Search answered ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  const seen = new Set<string>();
  return [...doc.querySelectorAll("[data-type='web']")].flatMap((r) => {
    const a = r.querySelector<HTMLAnchorElement>("a[href^='http']");
    const url = a?.getAttribute("href") ?? "";
    if (!url || seen.has(url) || /^https?:\/\/([^/]+\.)?brave\.com\//.test(url)) return [];
    seen.add(url);
    const title = strip(r.querySelector(".title, [class*='title']")?.textContent ?? a?.textContent ?? "");
    const snippet = strip(r.querySelector(".snippet-description, .generic-snippet, [class*='description'], .content")?.textContent ?? "");
    return [{ title: title || url, url, snippet: snippet.slice(0, 400) }];
  });
}

/** Runs inside DuckDuckGo's own results page, opened in a background tab. */
export function readDuckDuckGoPage(): Array<{ title: string; url: string; snippet: string }> {
  return [...document.querySelectorAll("article[data-testid='result']")].flatMap((r) => {
    const a = r.querySelector<HTMLAnchorElement>("a[data-testid='result-title-a']");
    if (!a?.href) return [];
    return [{
      title: (a.textContent ?? "").replace(/\s+/g, " ").trim(),
      url: a.href,
      snippet: (r.querySelector("[data-result='snippet']")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
    }];
  });
}

/**
 * `render` opens a URL in a background tab and returns what readDuckDuckGoPage finds there;
 * the executor supplies it because only it knows the user's window.
 */
export async function webSearch(query: string, render?: (url: string) => Promise<SearchResult[]>, signal?: AbortSignal): Promise<SearchResult[]> {
  for (const engine of [brave, duckDuckGo]) {
    try {
      const results = await engine(query, signal);
      if (results.length) return results.slice(0, 8);
    } catch { /* next engine */ }
  }
  return render ? (await render(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`)).slice(0, 8) : [];
}

export function formatResults(query: string, results: SearchResult[]): string {
  if (!results.length) return `No results for "${query}". Try other words, or read a known site with read_url.`;
  return [
    `Web results for "${query}" (open the most relevant with read_url before answering; cite the links you used):`,
    ...results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`),
  ].join("\n");
}

/**
 * Readable text of a fetched HTML document, or "" when the page builds its content with
 * JavaScript (live results, dashboards) and the HTML alone says almost nothing.
 */
export function textOfHtml(html: string): { title: string; text: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, svg, nav, footer, header, form, iframe").forEach((n) => n.remove());
  const main = doc.querySelector("main, article, [role=main]") ?? doc.body;
  const text = (main?.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return { title: strip(doc.title), text };
}
