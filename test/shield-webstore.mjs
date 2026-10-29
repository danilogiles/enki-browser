// "Install in Enki" on Chrome Web Store pages, end to end in a built Enki Browser for Linux: its
// own launcher, its own flags (config/flags.txt, with
// --extension-mime-request-handling=always-prompt-for-install) and the Shield built into it.
//
// Offline (the default), chromewebstore.google.com, clients2.google.com,
// clients2.googleusercontent.com and www.google.com go to a local HTTPS server: a fake store
// page that sets a google.com cookie, Google's update service answering with a redirect to a
// real, signed CRX3 made by test/crx3.mjs, and its update-check reply. It checks that:
//   - the button lives in a closed shadow root and ignores clicks the page makes up;
//   - the access note opens with focus on Cancel; Enter there and Escape both close it, with
//     nothing requested;
//   - Continue requests the CRX with no Cookie, Referer or X-Client-Data, from both clients2
//     hosts, while a google.com page right next to them gets the cookie; and nothing they set
//     sticks;
//   - Chromium installs the extension (its prompt is answered by a test switch), and Shield
//     records the id with the version from the file name;
//   - update checks are off, with no alarm; switched on, there is a 24-hour alarm and one check
//     with exactly prodversion (the real one), acceptformat and x = id, v, uc, and no cookies;
//     the notice offers 1.0.0 → 1.1.0 and Update installs it; switched off, the alarm is gone;
//   - Forget drops the record, and only Shield's own pages may ask for any of it.
//
//   node build/build-linux.mjs && xvfb-run -a node test/shield-webstore.mjs   (needs xdotool; exit 2 = skipped)
//   test/verify.mjs runs it on Linux, so CI's Linux job does too (ENKI_SKIP_WEBSTORE_E2E=1 skips)
//   ENKI_LINUX_DIR=/opt/enki-browser xvfb-run -a node test/shield-webstore.mjs
//   ENKI_WEBSTORE_ONLINE=1 xvfb-run -a node test/shield-webstore.mjs    the real store and Google
//     (opt-in; installs ENKI_WEBSTORE_ID, by default a small public extension, into a throwaway
//     profile and reads the headers Chromium really sent from DevTools)
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { packCrx3 } from "./crx3.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.resolve(process.env.ENKI_LINUX_DIR ?? path.join(root, "out", "linux", "enki-browser"));
const online = process.env.ENKI_WEBSTORE_ONLINE === "1";
if (process.platform !== "linux") { console.log("SKIP shield-webstore: Linux only (see docs/WEBSTORE.md for Windows and macOS)"); process.exit(0); }
if (!existsSync(path.join(app, "enki-browser"))) { console.error(`no Enki Browser at ${app}: run node build/build-linux.mjs, or set ENKI_LINUX_DIR`); process.exit(1); }
// Chromium's install prompt is a native window, answered with real keys.
if (!process.env.DISPLAY || spawnSync("xdotool", ["version"]).status !== 0) { console.log("SKIP shield-webstore: needs a display (xvfb-run) and xdotool"); process.exit(2); }
const shieldId = JSON.parse(readFileSync(path.join(app, "version.json"), "utf8")).shieldExtensionId;

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + ms;
  let last;
  do { last = await fn().catch(() => undefined); if (last) return last; await sleep(250); } while (Date.now() < end);
  return last;
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "enki-webstore-"));
const home = path.join(tmp, "home"); // Chromium's Downloads folder is $HOME/Downloads
const userData = path.join(tmp, "profile");
mkdirSync(path.join(home, "Downloads"), { recursive: true });

// The extension the fake store sells: one key, two versions.
const manifest = (version) => JSON.stringify({ manifest_version: 3, name: "Enki store test", version, description: "test" });
const v1 = packCrx3({ "manifest.json": manifest("1.0.0") });
const v2 = packCrx3({ "manifest.json": manifest("1.1.0") }, v1);
let latest = { version: "1.0.0", crx: v1.crx };
const testId = online ? (process.env.ENKI_WEBSTORE_ID ?? "fcoeoabgfenejglbffodgkkbkcdhcgfn") : v1.id;
const storeUrl = online ? `https://chromewebstore.google.com/detail/${testId}` : `https://chromewebstore.google.com/detail/enki-store-test/${testId}`;

const seen = []; // { host, url, headers }
let server, port;
if (!online) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=enki-test",
    "-keyout", path.join(tmp, "key.pem"), "-out", path.join(tmp, "cert.pem")], { stdio: "ignore" });
  server = https.createServer({ key: readFileSync(path.join(tmp, "key.pem")), cert: readFileSync(path.join(tmp, "cert.pem")) }, (req, res) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    seen.push({ host, url: req.url, headers: req.headers });
    const u = new URL(req.url, `https://${host}`);
    if (host === "chromewebstore.google.com") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
        "set-cookie": "NID=enki-test-nid; Domain=google.com; Path=/; Secure; SameSite=None; Max-Age=3600" });
      return res.end(`<!doctype html><title>Enki store test - Chrome Web Store</title><body><main><h1>Enki store test</h1><p>A test listing.</p></main>`);
    }
    if (host === "clients2.google.com" && u.pathname === "/service/update2/crx") {
      const cookie = { "set-cookie": "C2=from-clients2; Domain=google.com; Path=/; Secure; SameSite=None; Max-Age=3600" };
      if (u.searchParams.get("response") === "redirect") {
        res.writeHead(302, { ...cookie, location: `https://clients2.googleusercontent.com/crx/blobs/enki-test/${testId.toUpperCase()}_${latest.version.replace(/\./g, "_")}.crx` });
        return res.end();
      }
      const x = new URLSearchParams(u.searchParams.get("x") ?? "");
      const app = x.get("id") === testId
        ? `<app appid="${testId}" status="ok"><updatecheck codebase="https://clients2.googleusercontent.com/crx/blobs/enki-test/${testId.toUpperCase()}_${latest.version.replace(/\./g, "_")}.crx" status="${latest.version === x.get("v") ? "noupdate" : "ok"}" version="${latest.version}"/></app>`
        : `<app appid="${x.get("id")}" status="error-unknownApplication"/>`;
      res.writeHead(200, { ...cookie, "content-type": "text/xml; charset=utf-8" });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0" server="prod">${app}</gupdate>`);
    }
    if (host === "clients2.googleusercontent.com" && u.pathname.endsWith(".crx")) {
      res.writeHead(200, { "content-type": "application/x-chrome-extension", "content-length": latest.crx.length,
        "set-cookie": "GUC=from-blob; Path=/; Secure; SameSite=None; Max-Age=3600" });
      return res.end(latest.crx);
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>google</title>ok");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
}

// The real launcher, as people start it; DevTools on a free port for the test to drive it.
const cdpPort = 9400 + Math.floor(Math.random() * 400);
const args = [`--remote-debugging-port=${cdpPort}`, "--no-first-run", "--no-default-browser-check"];
if (!online) {
  const hosts = ["chromewebstore.google.com", "clients2.google.com", "clients2.googleusercontent.com", "www.google.com"];
  args.push(`--host-resolver-rules=${hosts.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(",")}`, "--ignore-certificate-errors");
}
args.push("about:blank");
const child = spawn(path.join(app, "enki-browser"), args, {
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache"), ENKI_BROWSER_USER_DATA: userData },
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
child.stderr.on("data", (d) => { stderr += d; });

let browser;
const done = async (error) => {
  if (error) { console.error(error); results.push(false); }
  await browser?.close().catch(() => {});
  child.kill("SIGTERM");
  await sleep(500);
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
};

try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`), 30000);
  if (!browser) throw new Error(`Enki Browser did not open DevTools on ${cdpPort}\n${stderr.slice(-2000)}`);
  const ctx = browser.contexts()[0];
  const bcdp = await browser.newBrowserCDPSession();
  // Playwright routes every download into its own folder, where Chromium never sees a .crx as an
  // extension; back to Chromium's own handling, as without DevTools.
  await bcdp.send("Browser.setDownloadBehavior", { behavior: "default" });
  const product = (await bcdp.send("Browser.getVersion")).product; // Chrome/154.0.8037.97
  const chromeVersion = product.split("/")[1];

  // Shield's settings page can read its storage and alarms, and sends messages as Shield.
  const options = await ctx.newPage(); const pageErrors = [];
  options.on("pageerror", (e) => pageErrors.push(e.message));
  await until(async () => { await options.goto(`chrome-extension://${shieldId}/options.html`); return options.evaluate(() => !!chrome.storage); }, 20000);
  const storage = (key) => options.evaluate((k) => chrome.storage.local.get(k).then((r) => r[k]), key);
  const alarm = () => options.evaluate(() => chrome.alarms.get("shield-cws-updates").then((a) => a ?? null));

  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const sent = []; // headers Chromium sent, from DevTools (online mode)
  if (online) {
    const urls = new Map();
    await cdp.send("Network.enable");
    cdp.on("Network.requestWillBeSent", (e) => urls.set(e.requestId, e.request.url));
    // A redirect keeps the request id, so each hop's address comes from its own HTTP/2 pseudo
    // headers (Google answers over HTTP/2 or 3) when it has them.
    cdp.on("Network.requestWillBeSentExtraInfo", (e) => {
      const h = e.headers, own = h[":authority"] && `https://${h[":authority"]}${h[":path"] ?? "/"}`;
      sent.push({ id: e.requestId, headers: h, get url() { return own || urls.get(e.requestId); } });
    });
  }
  await page.goto(storeUrl, { waitUntil: "domcontentloaded" });
  if (!online) await page.goto(storeUrl, { waitUntil: "domcontentloaded" }); // now with the cookie
  const storeCookie = online ? "" : seen.filter((r) => r.host === "chromewebstore.google.com").at(-1)?.headers.cookie ?? "";

  // The button's nodes, through the closed shadow root (DevTools can see into it; the page can't).
  const nodes = async () => {
    const { root: doc } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const all = [];
    const walk = (n) => { all.push(n); for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) walk(c); };
    walk(doc);
    const host = all.find((n) => n.localName === "enki-shield-store");
    if (!host) return null;
    const inside = [];
    const walkIn = (n) => { inside.push(n); for (const c of n.children ?? []) walkIn(c); };
    for (const s of host.shadowRoots ?? []) walkIn(s);
    const attr = (n, a) => { const i = (n.attributes ?? []).indexOf(a); return i >= 0 && i % 2 === 0 ? n.attributes[i + 1] : null; };
    const buttons = inside.filter((n) => n.localName === "button");
    const card = inside.find((n) => attr(n, "role") === "alertdialog");
    const err = inside.find((n) => attr(n, "role") === "alert");
    return { host, shadowType: host.shadowRoots?.[0]?.shadowRootType, install: buttons[0], cancel: buttons[1], go: buttons[2],
      installDisabled: attr(buttons[0], "aria-disabled"), installTab: attr(buttons[0], "tabindex"),
      cardOpen: card ? attr(card, "hidden") === null : false, errorShown: err ? attr(err, "hidden") === null : false };
  };
  const click = async (which) => { // nodes are fetched again: every DOM.getDocument renumbers them
    const node = (await nodes())[which];
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId });
    const q = model.border;
    await page.mouse.click((q[0] + q[4]) / 2, (q[1] + q[5]) / 2); // real input: isTrusted
  };
  const crxRequests = () => online
    ? sent.filter((r) => /^https:\/\/clients2\.google(usercontent)?\.com\//.test(r.url ?? ""))
    : seen.filter((r) => r.host === "clients2.google.com" || r.host === "clients2.googleusercontent.com");

  let n = await until(nodes, 15000);
  check("the store page gets the Install in Enki button", !!n?.install);
  if (!n?.install) throw new Error("no button");
  check("…in a closed shadow root", n.shadowType === "closed" && (await page.evaluate(() => document.querySelector("enki-shield-store").shadowRoot === null)), n.shadowType);

  // A click the page makes up does nothing.
  const { object } = await cdp.send("DOM.resolveNode", { nodeId: n.install.nodeId });
  await cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function () { this.click(); }" });
  await sleep(500);
  check("a click the page makes up (isTrusted false) opens nothing", !(await nodes()).cardOpen);

  await click("install");
  n = await until(async () => { const x = await nodes(); return x.cardOpen && x; }, 5000);
  check("a real click opens the access note first", !!n?.cardOpen);
  check("…and holds Install disabled while it is open (aria-disabled, out of the tab order)", n?.installDisabled === "true" && n?.installTab === "-1", `${n?.installDisabled} ${n?.installTab}`);
  await page.keyboard.press("Enter"); // focus starts on Cancel: Enter cancels
  await sleep(400);
  check("…with focus on Cancel (Enter closes it)", !(await nodes()).cardOpen);
  await click("install");
  await until(async () => (await nodes()).cardOpen, 5000);
  await click("install"); // the dimmed Install, while the note is open
  await sleep(400);
  check("…where a real click on the held Install does nothing", (await nodes()).cardOpen && crxRequests().length === 0);
  await page.keyboard.press("Tab"); // Install is out of the tab order: Tab lands in the note again
  await page.keyboard.press("Escape");
  await sleep(400);
  n = await nodes();
  check("…and Escape closes it", !n.cardOpen);
  check("…and gives Install back (aria-disabled false, tabindex 0)", n.installDisabled === "false" && n.installTab === "0", `${n.installDisabled} ${n.installTab}`);
  check("…and nothing was requested while it was open or after cancelling", crxRequests().length === 0, crxRequests().map((r) => r.url).join(" "));

  // Continue, then Chromium's own "Add …?" prompt: first Cancel (its default button), then Add.
  const downloads = path.join(home, "Downloads");
  const crxLeft = () => readdirSync(downloads).filter((f) => f.endsWith(".crx"));
  const extDir = path.join(userData, "Default", "Extensions", testId);
  const isInstalled = (prefix = "") => existsSync(extDir) && readdirSync(extDir).some((d) => d.startsWith(prefix));
  const answerPrompt = async (accept, done) => {
    // The prompt opens once the download is complete; it is a native window, so real keys.
    await until(async () => crxLeft().length > 0 || done(), 60000);
    await sleep(2500);
    if (done()) return; // nothing to answer
    for (const key of accept ? ["Tab", "Return"] : ["Return"]) { execFileSync("xdotool", ["key", key]); await sleep(700); }
  };
  await click("install");
  await until(async () => (await nodes()).cardOpen, 5000);
  await click("go");
  await answerPrompt(false, () => false);
  await sleep(2000);
  const leftover = crxLeft();
  check("Cancel in Chromium's prompt installs nothing", !isInstalled());
  check("…and leaves the .crx in Downloads (documented in docs/WEBSTORE.md: Shield has no downloads permission to remove it)",
    leftover.length === 1 && leftover[0].toLowerCase().startsWith(`${testId}_`), leftover.join(", "));
  for (const f of leftover) rmSync(path.join(downloads, f));
  seen.length = 0; sent.length = 0;

  await sleep(4000); // the button is busy for a moment after Continue
  await click("install");
  await until(async () => (await nodes()).cardOpen, 5000);
  await click("go");
  await answerPrompt(true, () => isInstalled());
  const installed = await until(async () => isInstalled(), 60000);
  check("Continue, then Add in Chromium's prompt: the extension is installed", !!installed, installed ? readdirSync(extDir).join(",") : stderr.slice(-800));
  check("…and Shield shows no error", !(await nodes()).errorShown);

  const reqs = crxRequests();
  const c2 = reqs.find((r) => (online ? new URL(r.url).host : r.host) === "clients2.google.com");
  const blob = reqs.find((r) => (online ? new URL(r.url).host : r.host) === "clients2.googleusercontent.com");
  const lower = (h) => Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  for (const [label, r] of [["clients2.google.com", c2], ["clients2.googleusercontent.com", blob]]) {
    // Online, DevTools does not always report the hop that turned into a download; offline, the
    // local server sees every request, so that is the run that must have both.
    if (online && !r && label.includes("usercontent")) { console.log(`INFO ${label}: DevTools did not report this hop's headers this run`); continue; }
    const h = lower(r?.headers);
    check(`${label} was asked for the CRX`, !!r, r?.url);
    check(`…without Cookie, Referer or X-Client-Data`, !!r && !h.cookie && !h.referer && !h["x-client-data"], JSON.stringify({ cookie: h.cookie, referer: h.referer, xcd: h["x-client-data"] }));
  }
  if (c2) {
    const u = new URL(c2.url, "https://clients2.google.com"), x = new URLSearchParams(u.searchParams.get("x"));
    check("the CRX address: response=redirect, acceptformat, the real prodversion, x = id, installsource, uc",
      [...u.searchParams.keys()].sort().join() === "acceptformat,prodversion,response,x" && u.searchParams.get("prodversion") === chromeVersion
        && [...x.keys()].join() === "id,installsource,uc" && x.get("id") === testId, `${u.search} (browser ${chromeVersion})`);
  }

  if (!online) {
    check("control: the store page itself was sent the google.com cookie", /NID=enki-test-nid/.test(storeCookie), storeCookie);
    await page.goto("https://www.google.com/control", { waitUntil: "domcontentloaded" });
    const g = seen.filter((r) => r.host === "www.google.com").at(-1);
    check("control: www.google.com, outside the rule, still gets it", /NID=enki-test-nid/.test(g?.headers.cookie ?? ""), g?.headers.cookie);
    check("…and nothing clients2 set was kept (no C2 or GUC cookie)", !/C2=|GUC=/.test(g?.headers.cookie ?? ""), g?.headers.cookie);
    const { cookies } = await cdp.send("Network.getAllCookies");
    check("…not even for googleusercontent.com (the cookie jar has neither)", !cookies.some((c) => c.name === "C2" || c.name === "GUC" || /googleusercontent/.test(c.domain)), cookies.map((c) => `${c.name}@${c.domain}`).join(" "));
  }

  if (online) {
    const { cookies } = await cdp.send("Network.getAllCookies");
    console.log(`INFO google.com cookies in the jar during the install: ${cookies.filter((c) => /google\.com$/.test(c.domain)).map((c) => `${c.name}@${c.domain}`).join(" ") || "none"}`);
  }
  const record = await until(async () => (await storage("shields:cws-installed"))?.[testId], 10000);
  if (online) check("Shield recorded the install with a version from the file name", /^\d+(\.\d+)*$/.test(record?.version ?? ""), JSON.stringify(record));
  else check("Shield recorded the install: name, and version 1.0.0 from the file name", record?.name === "Enki store test" && record?.version === "1.0.0", JSON.stringify(record));

  // Only a store page may ask for an install, only Shield's own pages for the rest.
  const r1 = await options.evaluate(() => chrome.runtime.sendMessage({ what: "enki-shield:cws-install", name: "x" }));
  check("an install request from anywhere but a store page is refused", !r1?.ok && !!r1?.error, JSON.stringify(r1));

  // Update checks: off, with no alarm, until switched on.
  check("update checks are off by default", (await storage("shields:cws-updates")) !== true);
  check("…with no alarm", (await alarm()) === null);
  const before = seen.length;
  if (!online) latest = { version: "1.1.0", crx: v2.crx };
  await options.reload();
  // The switch: drawn 38x22, but a 44x44 target around it answers (popup.css), and the 2px focus
  // ring stays. Turned on by a click in the target's corner, outside the drawn switch.
  await options.waitForSelector("#cws-updates");
  const hit = await options.evaluate(() => {
    const sw = document.getElementById("cws-updates");
    sw.scrollIntoView({ block: "center" }); // elementFromPoint only sees the viewport
    const r = sw.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hits = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === sw || sw.contains(e)); };
    let inside = 0, total = 0;
    for (const dx of [-21.5, -15, 0, 15, 21.5]) for (const dy of [-21.5, -15, 0, 15, 21.5]) { total++; if (hits(cx + dx, cy + dy)) inside++; }
    return { w: Math.round(r.width), h: Math.round(r.height), inside, total, outside: hits(cx + 26, cy) || hits(cx, cy + 26) };
  });
  check("the update switch is drawn 38x22 with a 44x44 target", hit.w === 38 && hit.h === 22 && hit.inside === hit.total && !hit.outside, JSON.stringify(hit));
  await options.focus("#cws-updates");
  await options.keyboard.press("Shift+Tab"); await options.keyboard.press("Tab"); // keyboard focus, so :focus-visible
  const ring = await options.evaluate(() => { const c = getComputedStyle(document.getElementById("cws-updates")); return `${c.outlineStyle} ${c.outlineWidth}`; });
  check("…with its 2px focus ring", ring === "solid 2px", ring);
  const box = await options.locator("#cws-updates").boundingBox();
  await options.mouse.click(box.x + box.width / 2 + 20.5, box.y + box.height / 2 - 20.5);
  const a = await until(alarm, 5000);
  check("switched on: a 24-hour alarm", a?.periodInMinutes === 1440, JSON.stringify(a));
  const checked = await until(async () => storage("shields:cws-checkedAt"), 15000);
  check("…and a check right away", !!checked);
  if (!online) {
    const upd = seen.slice(before).find((r) => r.host === "clients2.google.com");
    const u = upd && new URL(upd.url, "https://clients2.google.com"), x = u && new URLSearchParams(u.searchParams.get("x"));
    check("the check carries exactly prodversion, acceptformat and x = id, v, uc",
      !!u && [...u.searchParams.keys()].sort().join() === "acceptformat,prodversion,x" && [...x.keys()].join() === "id,v,uc"
        && x.get("id") === testId && x.get("v") === "1.0.0" && x.get("uc") === "" && u.searchParams.get("prodversion") === chromeVersion, upd?.url);
    check("…with no Cookie, Referer or X-Client-Data", !!upd && !upd.headers.cookie && !upd.headers.referer && !upd.headers["x-client-data"], JSON.stringify(upd?.headers));
    check("…for Shield's installs only", seen.slice(before).filter((r) => r.host === "clients2.google.com").every((r) => new URLSearchParams(new URL(r.url, "https://x").searchParams.get("x")).get("id") === testId));
    const l = await until(async () => (await storage("shields:cws-latest"))?.[testId], 5000);
    check("…which finds 1.1.0", l === "1.1.0" || l?.version === "1.1.0", JSON.stringify(l));
    await options.reload();
    const notice = await until(async () => (await options.locator("#cws-notices .cws-notice").count()) && options.locator("#cws-notices .cws-notice").innerText(), 5000);
    check("the settings page shows the update notice, 1.0.0 → 1.1.0", /1\.0\.0/.test(notice ?? "") && /1\.1\.0/.test(notice ?? ""), notice);
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${shieldId}/popup.html`);
    const pn = await until(async () => popup.locator("#cws-notices .cws-notice").count(), 5000);
    check("…and so does the Shields panel", pn > 0);
    await popup.close();

    const b2 = seen.length;
    await options.locator("#cws-notices .cws-notice button.pill:not(.quiet)").click();
    await answerPrompt(true, () => isInstalled("1.1.0"));
    const v11 = await until(async () => readdirSync(extDir).some((d) => d.startsWith("1.1.0")) && (await storage("shields:cws-installed"))?.[testId]?.version === "1.1.0", 60000);
    check("Update: the same CRX address and Chromium's prompt install 1.1.0, and Shield records it", !!v11, readdirSync(extDir).join(","));
    const again = seen.slice(b2).find((r) => r.host === "clients2.google.com");
    check("…with no cookies either", !!again && !again.headers.cookie && new URL(again.url, "https://x").searchParams.get("response") === "redirect", again?.url);
    check("…and the notice is gone", !(await storage("shields:cws-latest"))?.[testId]);
  }

  await options.reload();
  await options.click("#cws-updates");
  check("switched off: the alarm is gone", (await until(async () => (await alarm()) === null, 5000)) === true);

  const r2 = await page.evaluate(() => typeof chrome !== "undefined" && !!chrome.runtime?.sendMessage);
  check("store pages themselves cannot message Shield (no chrome.runtime in the page)", r2 === false);

  await options.reload();
  await options.locator("#cws-list button").first().click();
  check("Forget removes Shield's record", (await until(async () => !(await storage("shields:cws-installed"))?.[testId], 5000)) === true);

  check("no script errors on Shield's settings page", pageErrors.length === 0, pageErrors.join(" | "));
  const left = crxLeft();
  check("accepted installs leave no .crx in Downloads (a cancelled prompt does; see docs/WEBSTORE.md)", left.length === 0, left.join(", "));
  await done();
} catch (e) {
  await done(e);
}
