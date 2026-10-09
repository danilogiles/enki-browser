import "./shields.js";
import "./burn.js";
import "./menu.js";
import { welcomeOnce } from "./default-browser.js";
import { native } from "./updates.js";
// Enki Shield: warns before a known phishing site opens.
//
// Privacy is the point of doing this locally. Google Safe Browsing (which ungoogled-chromium
// removes) sends hashes of visited URLs to Google; here the whole list is downloaded twice a
// day and every check happens on this device, so the sites someone visits never leave it.
//
// Two mechanisms, because the list has two kinds of entry:
//  - ~40k whole domains go into ONE declarativeNetRequest block rule (requestDomains matches
//    subdomains too). Chromium refuses the navigation before any DNS lookup or connection.
//  - ~27k host+path entries (one page on a shared host such as weebly.com or sites.google.com)
//    cannot be a rule each within Chromium's dynamic-rule limits, so they are checked when a
//    navigation starts and the tab is sent to the warning page before the page is usable.
// Either way the user lands on blocked.html, which explains and offers a way back.

const SOURCES = [
  "https://malware-filter.gitlab.io/malware-filter/phishing-filter.txt",
  "https://malware-filter.pages.dev/phishing-filter.txt",
];
// Always blocked, never in any real list: lets anyone (and verify.mjs) test the warning without
// visiting a real phishing site. .invalid is reserved and can never resolve.
const CANARY = "enki-shield.invalid";
// The page-level test: only this path on this host is listed, so the same host with any other
// path must load (well, fail to resolve) — which tests precision as well as the mechanism.
const CANARY_PAGE = "enki-shield-page.invalid/phish";
const DOMAIN_RULE = 1;
const REFRESH_MINUTES = 12 * 60;
// A download this small is an error page or a truncated file, not the list: keep the old one
// rather than silently dropping protection.
const MIN_DOMAINS = 5000;

let cache = null; // { domains: Set, paths: Map<host, string[]>, updatedAt, source }

function parse(text) {
  const domains = new Set();
  const paths = new Map();
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line || line.startsWith("!") || line.startsWith("#")) continue;
    // Page entries use uBlock syntax: ||host/path^$all, with "&" still HTML-escaped.
    if (line.startsWith("||")) line = line.slice(2);
    line = line.replace(/\$.*$/, "").replace(/\^$/, "");
    while (line.includes("&amp;")) line = line.replaceAll("&amp;", "&"); // some entries are escaped twice
    const slash = line.indexOf("/");
    const host = (slash === -1 ? line : line.slice(0, slash)).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(host) || !host.includes(".")) continue; // "_" occurs in real subdomains
    if (slash === -1) domains.add(host);
    else {
      const list = paths.get(host) ?? [];
      list.push(host + line.slice(slash));
      paths.set(host, list);
    }
  }
  const host = CANARY_PAGE.slice(0, CANARY_PAGE.indexOf("/"));
  paths.set(host, [...(paths.get(host) ?? []), CANARY_PAGE]);
  return { domains, paths };
}

async function load() {
  if (cache) return cache;
  const { "shield:list": stored } = await chrome.storage.local.get("shield:list");
  cache = stored
    ? { domains: new Set(stored.domains), paths: new Map(stored.paths), updatedAt: stored.updatedAt, source: stored.source }
    : { domains: new Set(), paths: new Map(), updatedAt: 0, source: null };
  const canaryHost = CANARY_PAGE.slice(0, CANARY_PAGE.indexOf("/"));
  if (!cache.paths.get(canaryHost)?.includes(CANARY_PAGE)) cache.paths.set(canaryHost, [...(cache.paths.get(canaryHost) ?? []), CANARY_PAGE]);
  return cache;
}

async function applyRules(domains) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [DOMAIN_RULE],
    addRules: [{
      id: DOMAIN_RULE,
      priority: 1,
      action: { type: "block" },
      condition: { requestDomains: [CANARY, ...domains], resourceTypes: ["main_frame", "sub_frame"] },
    }],
  });
}

async function refresh() {
  for (const source of SOURCES) {
    try {
      const res = await fetch(source, { cache: "no-store", signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { domains, paths } = parse(await res.text());
      if (domains.size < MIN_DOMAINS) throw new Error(`only ${domains.size} domains`);
      await applyRules(domains);
      cache = { domains, paths, updatedAt: Date.now(), source };
      await chrome.storage.local.set({
        "shield:list": { domains: [...domains], paths: [...paths], updatedAt: cache.updatedAt, source },
      });
      console.info(`[shield] ${domains.size} domains, ${[...paths.values()].reduce((n, l) => n + l.length, 0)} pages from ${source}`);
      return true;
    } catch (e) {
      console.warn(`[shield] ${source} failed: ${e.message}`);
    }
  }
  return false;
}

async function start() {
  chrome.alarms.create("shield-refresh", { periodInMinutes: REFRESH_MINUTES });
  const list = await load();
  // Re-apply what is stored first, so protection exists before (or without) the network.
  await applyRules(list.domains);
  if (Date.now() - list.updatedAt > REFRESH_MINUTES * 60_000) await refresh();
}

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);

// First-run guide (welcome.html): once per profile (default-browser.js).
const welcome = welcomeOnce({
  native,
  storage: chrome.storage.local,
  openPage: (page) => chrome.tabs.create({ url: chrome.runtime.getURL(page) }),
});
const offerDefault = () => void welcome().catch((e) => console.warn(`[shield] default browser page: ${e.message}`));
chrome.runtime.onInstalled.addListener(offerDefault);
chrome.runtime.onStartup.addListener(offerDefault);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "shield-refresh") void refresh(); });

// ------------------------------------------------------------------ matching

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

function domainHit(list, host) {
  if (host === CANARY || host.endsWith("." + CANARY)) return true;
  for (let h = host; h.includes("."); h = h.slice(h.indexOf(".") + 1)) if (list.domains.has(h)) return true;
  return false;
}

function pathHit(list, url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const bare = u.hostname.toLowerCase() + u.pathname + u.search;
  for (let h = u.hostname.toLowerCase(); h.includes("."); h = h.slice(h.indexOf(".") + 1)) {
    for (const entry of list.paths.get(h) ?? []) if (bare.startsWith(entry) || (u.hostname.toLowerCase() + u.pathname).startsWith(entry)) return true;
  }
  return false;
}

async function allowed(host) {
  const { "shield:allowed": hosts = [] } = await chrome.storage.session.get("shield:allowed");
  return hosts.includes(host);
}

function warn(tabId, url) {
  const page = chrome.runtime.getURL("blocked.html") + "?url=" + encodeURIComponent(url);
  return chrome.tabs.update(tabId, { url: page });
}

// Whole-domain hits are refused by the rule; turn Chromium's bare error page into ours.
chrome.webNavigation.onErrorOccurred.addListener(async (d) => {
  if (d.frameId !== 0 || !/ERR_BLOCKED_BY_CLIENT/.test(d.error)) return;
  const host = hostOf(d.url);
  if (!host || (await allowed(host))) return;
  if (domainHit(await load(), host)) await warn(d.tabId, d.url);
});

// Single pages on shared hosts are caught as the navigation starts.
chrome.webNavigation.onBeforeNavigate.addListener(async (d) => {
  if (d.frameId !== 0 || !/^https?:/.test(d.url)) return;
  const host = hostOf(d.url);
  if (!host || (await allowed(host))) return;
  if (pathHit(await load(), d.url)) await warn(d.tabId, d.url);
});

// ------------------------------------------------------------------ messages

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg?.type === "shield:status") {
      const list = await load();
      const pages = [...list.paths.values()].reduce((n, l) => n + l.length, 0);
      return { domains: list.domains.size, pages, updatedAt: list.updatedAt, source: list.source };
    }
    if (msg?.type === "shield:allow" && typeof msg.host === "string") {
      // The user chose to continue: this host only, this browser session only. An allow rule of
      // higher priority lets it through the block rule; both vanish when the browser closes.
      const { "shield:allowed": hosts = [] } = await chrome.storage.session.get("shield:allowed");
      if (!hosts.includes(msg.host)) hosts.push(msg.host);
      await chrome.storage.session.set({ "shield:allowed": hosts });
      const id = 1000 + hosts.indexOf(msg.host);
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [id],
        addRules: [{ id, priority: 2, action: { type: "allow" }, condition: { requestDomains: [msg.host], resourceTypes: ["main_frame", "sub_frame"] } }],
      });
      return { ok: true };
    }
    if (msg?.type === "shield:refresh") return { ok: await refresh() };
    if (msg?.type === "shield:check" && typeof msg.url === "string") {
      const list = await load();
      const host = hostOf(msg.url);
      return { domain: !!host && domainHit(list, host), page: pathHit(list, msg.url) };
    }
    // A sample entry, so tests can prove a real listed domain is refused without hard-coding
    // one that may have left the list by the time they run.
    if (msg?.type === "shield:sample") {
      const list = await load();
      for (const d of list.domains) if (d.split(".").length === 2) return { domain: d };
      return { domain: null };
    }
    return null;
  })().then(reply);
  return true;
});
