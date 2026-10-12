// Skips AMP pages (issue #19), the publisher-side half. The Google and AMP-cache addresses are
// rewritten before they load by static rules (amp.json); this runs on the publisher's own AMP
// page (<html amp> or <html ⚡>) and goes to the regular page it names as canonical, only when
// that is https: and on the same site (registrable domain). No request is made to check
// anything, nothing is stored, and in every other case the page is left as it is.
(() => {
  // The registrable domain is worked out without the Public Suffix List (fetching it would be a
  // request, and it is too big to ship for this): the last two labels, three under a country's
  // second level (example.co.uk), and none, so no redirect, for an IP address or for a shared
  // host where every site is a subdomain and its neighbours are different sites.
  const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "ne", "or", "go", "gob", "nic", "mil", "ltd", "plc", "nom"]);
  const SHARED = new Set(["github.io", "gitlab.io", "blogspot.com", "wordpress.com", "tumblr.com", "medium.com", "substack.com",
    "netlify.app", "vercel.app", "pages.dev", "workers.dev", "web.app", "firebaseapp.com", "appspot.com", "herokuapp.com",
    "azurewebsites.net", "cloudfront.net", "amazonaws.com", "ampproject.org", "ampproject.net", "googleusercontent.com", "fly.dev", "onrender.com"]);
  function site(host) {
    host = host.toLowerCase().replace(/\.$/, "");
    if (!host.includes(".") || /^[\d.]+$/.test(host) || host.startsWith("[")) return null;
    const labels = host.split(".");
    const n = labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2)) ? 3 : 2;
    if (labels.length < n) return null;
    const domain = labels.slice(-n).join(".");
    if (SHARED.has(domain) || SHARED.has(labels.slice(-3).join("."))) return null;
    return domain;
  }

  const html = document.documentElement;
  if (!html || !(html.hasAttribute("amp") || html.hasAttribute("⚡"))) return;
  const href = document.querySelector('link[rel~="canonical" i][href]')?.getAttribute("href");
  if (!href) return;
  let to;
  try { to = new URL(href, location.href); } catch { return; }
  if (to.protocol !== "https:" || to.username || to.password) return;
  const here = new URL(location.href);
  if (to.origin === here.origin && to.pathname === here.pathname && to.search === here.search) return; // itself
  const mine = site(here.hostname);
  if (!mine || site(to.hostname) !== mine) return;
  if (!to.hash) to.hash = here.hash;
  location.replace(to.href);
})();
