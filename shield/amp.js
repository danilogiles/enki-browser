// De-AMP: an AMP page that names its regular version (<link rel="canonical">) is left for that
// version before it renders, as Brave and DuckDuckGo do. Google's own AMP copies never get here:
// rules/debounce.json rewrites those addresses before they load. This covers AMP pages a site
// hosts itself (example.com/amp/…), which only the page can tell apart.
//
// A canonical page that sends a phone back to AMP would bounce forever, so the address this
// page already left once in this tab is remembered (sessionStorage, per site) and not left again.
(() => {
  if (window.top !== window) return;
  const LEFT = "enki-shield:deamp-left";
  const leave = () => {
    const html = document.documentElement;
    if (!html || !(html.hasAttribute("amp") || html.hasAttribute("⚡"))) return false;
    const link = document.querySelector('link[rel~="canonical"]');
    if (!link) return false;
    let target;
    try { target = new URL(link.getAttribute("href"), location.href); } catch { return true; }
    if (!/^https?:$/.test(target.protocol) || target.href === location.href) return true;
    try {
      if (sessionStorage.getItem(LEFT) === location.href) return true;
      sessionStorage.setItem(LEFT, location.href);
    } catch { /* storage blocked: leave anyway, once per load */ }
    location.replace(target.href);
    return true;
  };
  if (leave()) return;
  const watch = new MutationObserver(() => { if (leave()) watch.disconnect(); });
  watch.observe(document, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => { leave(); watch.disconnect(); }, { once: true });
})();
