// Skips AMP pages (issue #19), the publisher-side half. The Google and AMP-cache addresses are
// rewritten before they load by static rules (amp.json); this runs on the publisher's own AMP
// page (<html amp> or <html ⚡>) and goes to the regular page it names as canonical, only when
// that is https: and on the exact same host, or the same host with www. added or removed. No
// request is made to check anything, nothing is stored, and in every other case the page is left
// as it is.
(() => {
  // No registrable-domain guess: without the Public Suffix List, a.herokuapp.com and
  // b.herokuapp.com look like one site, and a page could send people to another customer of the
  // same host. Exact host, or the www. twin, is all that counts; news.example.com → example.com
  // stays put.
  const bare = (host) => host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  const sameHost = (a, b) => !!a && bare(a) === bare(b);

  const html = document.documentElement;
  if (!html || !(html.hasAttribute("amp") || html.hasAttribute("⚡"))) return;
  const href = document.querySelector('link[rel~="canonical" i][href]')?.getAttribute("href");
  if (!href) return;
  let to;
  try { to = new URL(href, location.href); } catch { return; }
  if (to.protocol !== "https:" || to.username || to.password) return;
  const here = new URL(location.href);
  if (to.origin === here.origin && to.pathname === here.pathname && to.search === here.search) return; // itself
  if (!sameHost(here.hostname, to.hostname)) return;
  if (!to.hash) to.hash = here.hash;
  location.replace(to.href);
})();
