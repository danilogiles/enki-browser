// Tracking parameters (#17). Loads shield/ from this checkout into Chromium with a throwaway
// profile, every host name pointed at a local HTTPS server, and checks:
//   - a page opened with utm_*, fbclid, gclid and the rest of Shield's list arrives without them,
//     while its other parameters (ref and id included) and its #fragment stay as they were;
//   - parameters merely named like them (utm_foo, a utm_source inside a value) are kept;
//   - frames are not rewritten (main_frame only);
//   - with Shields down for the site, nothing is removed, and with Shields up again it is.
//
//   xvfb-run -a node test/shield-params.mjs        Playwright's Chromium (npx playwright install chromium)
//   ENKI_LINUX_DIR=… xvfb-run -a node test/…        an installed Enki Browser's own Chromium
//   ENKI_CHROMIUM=/path/to/chrome …                 any Chromium that takes --load-extension
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shieldDir = path.resolve(process.env.ENKI_SHIELD_DIR ?? path.join(root, "shield"));
const enkiChrome = process.env.ENKI_LINUX_DIR && path.join(process.env.ENKI_LINUX_DIR, "chromium", "chrome");
const executablePath = process.env.ENKI_CHROMIUM ?? (enkiChrome && existsSync(enkiChrome) ? enkiChrome : chromium.executablePath());

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
async function until(fn, ms) {
  const end = Date.now() + ms;
  let last;
  do { last = await fn().catch(() => undefined); if (last) return last; await new Promise((r) => setTimeout(r, 250)); } while (Date.now() < end);
  return last;
}

// Every host name resolves to this one HTTPS server (a throwaway self-signed certificate), so
// real-looking addresses can be opened without the network.
const tmp = mkdtempSync(path.join(os.tmpdir(), "enki-shield-net-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=enki-test",
  "-keyout", path.join(tmp, "key.pem"), "-out", path.join(tmp, "cert.pem")], { stdio: "ignore" });
const seen = []; // { host, url, headers }
const server = https.createServer({ key: readFileSync(path.join(tmp, "key.pem")), cert: readFileSync(path.join(tmp, "cert.pem")) }, (req, res) => {
  seen.push({ host: req.headers.host, url: req.url, headers: req.headers });
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(page(req));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const userData = path.join(tmp, "profile");
const ctx = await chromium.launchPersistentContext(userData, {
  executablePath,
  headless: false,
  ignoreHTTPSErrors: true,
  args: [`--disable-extensions-except=${shieldDir}`, `--load-extension=${shieldDir}`, "--no-first-run", "--no-default-browser-check",
    `--host-resolver-rules=MAP * 127.0.0.1:${port}`, "--ignore-certificate-errors"],
});
const done = async () => {
  await ctx.close().catch(() => {});
  server.close();
  rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
};
const worker = async () => {
  const sw = await until(async () => ctx.serviceWorkers().find((w) => /\/background(-[0-9a-f]+)?\.js$/.test(new URL(w.url()).pathname)), 20000);
  if (!sw) throw new Error("Shield's worker did not start");
  return sw;
};

function page(req) {
  // An iframe whose own address carries a tracking parameter, on the first page only.
  return req.url.startsWith("/article") ? `<!doctype html><title>t</title><iframe src="https://frame.test/embed?utm_source=x&keep=1"></iframe>` : "<!doctype html><title>t</title>";
}

const ALL = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "fbclid", "gclid", "dclid",
  "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid", "igshid", "mc_eid", "_hsenc", "_hsmi", "li_fat_id"];
const keep = "a=1&ref=home&id=42&utm_foo=bar&q=utm_source%3Dx";
const query = ALL.map((p, i) => `${p}=v${i}`).join("&");
const lastOf = (host) => [...seen].reverse().find((s) => s.host.startsWith(host));

try {
  const sw = await worker();
  await until(() => sw.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).some((r) => r.id === 2)), 10000);
  const tab = await ctx.newPage();

  await tab.goto(`https://news.example/article?${query.split("&").slice(0, 10).join("&")}&${keep}&${query.split("&").slice(10).join("&")}#section-2`);
  const got = lastOf("news.example");
  const params = new URLSearchParams(got?.url.split("?")[1] ?? "");
  const left = ALL.filter((p) => params.has(p));
  check("every listed parameter is removed before the request leaves", got && left.length === 0, `${got?.url}${left.length ? ` (left: ${left.join(", ")})` : ""}`);
  check("the other parameters are kept, in order (ref, id, utm_foo and a value containing utm_source too)", got?.url === `/article?${keep}`, got?.url);
  check("the #fragment is kept", tab.url().endsWith(`/article?${keep}#section-2`), tab.url());
  await until(async () => lastOf("frame.test"), 5000);
  check("frames are left alone (main_frame only)", lastOf("frame.test")?.url === "/embed?utm_source=x&keep=1", lastOf("frame.test")?.url);

  await tab.goto("https://plain.example/page?x=1#top");
  check("a page without them is not touched", lastOf("plain.example")?.url === "/page?x=1" && tab.url().endsWith("/page?x=1#top"), tab.url());

  const ruleHas = (want) => async () => {
    const rule = (await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).find((r) => r.id === 2);
    return want(rule?.condition?.excludedRequestDomains ?? []) ? rule : null;
  };
  await sw.evaluate(() => globalThis.enkiShieldParams.setDown("down.example", true));
  check("Shields down for a site takes it out of the rule", !!(await until(ruleHas((d) => d.includes("down.example")), 5000)));
  await tab.goto("https://down.example/a?utm_source=x&gclid=y&b=2#f");
  check("…and nothing is removed there", lastOf("down.example")?.url === "/a?utm_source=x&gclid=y&b=2", lastOf("down.example")?.url);
  await tab.goto("https://www.down.example/a?fbclid=z");
  check("…nor on its subdomains", lastOf("www.down.example")?.url === "/a?fbclid=z", lastOf("www.down.example")?.url);
  await tab.goto("https://other.example/a?fbclid=z&b=2");
  check("…while other sites are still cleaned", lastOf("other.example")?.url === "/a?b=2", lastOf("other.example")?.url);
  await sw.evaluate(() => globalThis.enkiShieldParams.setDown("down.example", false));
  await until(ruleHas((d) => !d.includes("down.example")), 5000);
  await tab.goto("https://down.example/a?utm_source=x&b=2");
  check("Shields up again: removed there again", lastOf("down.example")?.url === "/a?b=2", lastOf("down.example")?.url);

  // Session storage holds the Shields panel's per-tab count (shields.js), as before; this adds nothing.
  const stored = await sw.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  check("no address it rewrote is stored", !/news\.example|other\.example|utm_source=v0/.test(stored));
} catch (e) {
  check("tracking parameters", false, e.stack ?? String(e));
}
await done();
