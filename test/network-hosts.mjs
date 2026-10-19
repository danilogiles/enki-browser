// Every host a built Enki Browser tries to reach must be listed in PRIVACY.md (the
// enki-allowed-hosts block). Starts the Linux build through its launcher with a new profile and no
// internet: every host name resolves to one local catch-all server (--host-resolver-rules), so
// nothing leaves the machine, and Chromium's own net log records each host the browser attempted.
// Covers, in order:
//   background  startup, the first run of Enki, Shield and uBlock (Shield's phishing list), an
//               idle wait, and two ordinary pages from a local server
//   user        a search typed into the address bar (DuckDuckGo, Enter), with xdotool
// A host seen in the background part must be listed as "background"; one seen after the search
// may be either. The test fails on an unlisted host, an empty or unreadable list, or an empty net
// log, and prints every host it saw.
//
//   ENKI_LINUX_DIR=… xvfb-run -a node test/network-hosts.mjs   default build: out/linux/enki-browser
//   node test/network-hosts.mjs --unit                          only the PRIVACY.md list checks (any OS)
//   ENKI_NO_SANDBOX=1 …                                         containers without user namespaces only
//   ENKI_NETWORK_IDLE_MS=20000 …                                the idle wait (default 20 s)
//
// CI: test/omnibox.mjs runs this at its end (the Linux job's built-browser tests), and its rule
// checks run the --unit part on every OS, so no workflow change is needed.
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BEGIN = "<!-- enki-allowed-hosts:begin -->";
const END = "<!-- enki-allowed-hosts:end -->";
const WHEN = new Set(["background", "user"]);
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** PRIVACY.md → Map(host → "background" | "user"). Throws when the block is missing, malformed or empty. */
export function parseAllowedHosts(markdown) {
  const begin = markdown.indexOf(BEGIN);
  const end = markdown.indexOf(END);
  if (begin < 0 || end < 0 || end < begin) throw new Error(`PRIVACY.md has no ${BEGIN} … ${END} block`);
  if (markdown.indexOf(BEGIN, begin + 1) >= 0) throw new Error("PRIVACY.md has more than one allowed-hosts block");
  const block = markdown.slice(begin + BEGIN.length, end).trim();
  const fence = /^```text\n([\s\S]*?)\n```$/.exec(block.replace(/\r\n/g, "\n"));
  if (!fence) throw new Error("the allowed-hosts block must be exactly one ```text fenced block");
  const hosts = new Map();
  for (const [i, raw] of fence[1].split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [host, when, ...why] = line.split(/\s+/);
    if (!HOST.test(host)) throw new Error(`allowed-hosts line ${i + 1}: "${host}" is not a host name`);
    if (!WHEN.has(when)) throw new Error(`allowed-hosts line ${i + 1}: "${when}" must be background or user`);
    if (!why.length) throw new Error(`allowed-hosts line ${i + 1}: ${host} needs a reason`);
    if (hosts.has(host)) throw new Error(`allowed-hosts line ${i + 1}: ${host} is listed twice`);
    hosts.set(host, when);
  }
  if (!hosts.size) throw new Error("the allowed-hosts block lists no host");
  return hosts;
}

/** The list's own checks: PRIVACY.md parses, and a broken list is refused rather than read as empty. */
export function checkAllowlist(check) {
  let hosts;
  try { hosts = parseAllowedHosts(readFileSync(path.join(root, "PRIVACY.md"), "utf8")); } catch (e) { check("PRIVACY.md's allowed-hosts list can be read", false, e.message); return null; }
  check("PRIVACY.md's allowed-hosts list can be read", hosts.size > 0, `${hosts.size} hosts`);
  const wrap = (body) => `x\n${BEGIN}\n\`\`\`text\n${body}\n\`\`\`\n${END}\n`;
  const refused = (md) => { try { parseAllowedHosts(md); return false; } catch { return true; } };
  check("…and a missing, empty or malformed list is refused",
    refused("no block") && refused(wrap("")) && refused(wrap("# only a comment")) && refused(wrap("not a host! background x"))
      && refused(wrap("a.example sometimes x")) && refused(wrap("a.example background")) && refused(wrap("a.example background x\na.example user y"))
      && refused(`${BEGIN}\na.example background x\n${END}`) && !refused(wrap("a.example background x")));
  return hosts;
}

const LOCAL = /^(127\.\d+\.\d+\.\d+|localhost|\[?::1\]?)$/;
/** A URL, "scheme://host:port", "host:port" or a bare host → its host name, or null for local and non-network ones. */
function hostOf(value) {
  if (typeof value !== "string" || !value) return null;
  let host;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    let u;
    try { u = new URL(value); } catch { return null; }
    if (!/^(https?|wss?|ftp):$/.test(u.protocol)) return null;
    host = u.hostname;
  } else if (/^[a-z0-9.-]+(:\d+)?$/i.test(value)) host = value.replace(/:\d+$/, "");
  else return null;
  host = host.toLowerCase().replace(/\.$/, "");
  if (LOCAL.test(host)) return null;
  // An IP address other than this machine's is reported as it is (and is never in the list).
  return /[.:]/.test(host) ? host : null;
}

const HOST_KEYS = new Set(["url", "original_url", "location", "host", "destination", "logical_destination", "server_host_port", "host_port", "origin"]);
/** Chromium's net log (complete, or cut off by a crash) → { hosts: Map(host → first time), events, marks }. */
export function hostsFromNetLog(text, markPrefix) {
  let log;
  try { log = JSON.parse(text); } catch {
    // Written as it goes: a browser that did not exit cleanly leaves the events array open.
    const cut = text.replace(/,?\s*$/, "");
    for (const tail of ["]}", "}]}", ""]) { try { log = JSON.parse(cut + tail); break; } catch {} }
  }
  if (!log || !Array.isArray(log.events)) throw new Error("the net log cannot be read");
  const hosts = new Map();
  const marks = new Map();
  for (const ev of log.events) {
    const t = Number(ev.time);
    for (const [k, v] of Object.entries(ev.params ?? {})) {
      if (!HOST_KEYS.has(k) || typeof v !== "string") continue;
      if (markPrefix && v.startsWith(markPrefix) && !marks.has(v)) marks.set(v, t);
      const h = hostOf(v);
      if (h && !(hosts.get(h) <= t)) hosts.set(h, t);
    }
  }
  return { hosts, events: log.events.length, marks };
}

/** Runs the browser part. `check(name, ok, detail)` records each result. */
export async function runNetworkHosts(check, { build = process.env.ENKI_LINUX_DIR ?? path.join(root, "out", "linux", "enki-browser"), allowed } = {}) {
  allowed ??= checkAllowlist(check);
  if (!allowed) return;
  if (process.platform !== "linux") { console.log(`SKIP network hosts: the browser part runs on Linux (${process.platform})`); return; }
  if (!process.env.DISPLAY) { check("network hosts: an X display (run under xvfb-run -a)", false); return; }
  if (!existsSync(path.join(build, "enki-browser"))) { check("network hosts: a built Enki Browser", false, `${build} has no enki-browser launcher`); return; }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "enki-network-hosts-"));
  const netlog = path.join(tmp, "netlog.json");
  const port = 9336;

  // Every host name lands here: TLS is refused after reading the name it asked for (SNI), plain
  // http gets an empty answer. What reached it is printed with the net log's list.
  const answered = new Set();
  const sniOf = (buf) => {
    try {
      let p = 5 + 4 + 2 + 32; // record header, handshake header, version, random
      p += 1 + buf[p]; p += 2 + buf.readUInt16BE(p); p += 1 + buf[p];
      const end = p + 2 + buf.readUInt16BE(p); p += 2;
      while (p + 4 <= end) {
        const type = buf.readUInt16BE(p), len = buf.readUInt16BE(p + 2); p += 4;
        if (type === 0) return buf.toString("ascii", p + 5, p + 5 + buf.readUInt16BE(p + 3));
        p += len;
      }
    } catch {}
    return null;
  };
  const catchAll = net.createServer((sock) => {
    sock.on("error", () => {});
    sock.once("data", (buf) => {
      if (buf[0] === 0x16) { const n = sniOf(buf); if (n) answered.add(n.toLowerCase()); sock.destroy(); return; }
      const h = /\r\nhost:\s*([^\r\n:]+)/i.exec(buf.toString("latin1"))?.[1];
      if (h) answered.add(h.toLowerCase());
      sock.end("HTTP/1.1 204 No Content\r\nconnection: close\r\n\r\n");
    });
  });
  await new Promise((r) => catchAll.listen(0, "127.0.0.1", r));
  // Two ordinary pages, on 127.0.0.1 (no name to resolve, and exempt from the https upgrade).
  const pages = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    if (req.url.startsWith("/two")) res.end("<!doctype html><title>Two</title><p>Second page.</p><img src='/pixel.gif'>");
    else res.end("<!doctype html><title>One</title><p>An ordinary page.</p><a href='/two'>two</a><script>fetch('/data.json')</script>");
  });
  await new Promise((r) => pages.listen(0, "127.0.0.1", r));
  const local = `http://127.0.0.1:${pages.address().port}`;
  const MARK = `${local}/__enki-phase/`;

  const args = [`--remote-debugging-port=${port}`, `--log-net-log=${netlog}`, "--net-log-capture-mode=Default",
    `--host-resolver-rules=MAP * 127.0.0.1:${catchAll.address().port}, EXCLUDE 127.0.0.1, EXCLUDE localhost`, "about:blank"];
  if (process.env.ENKI_NO_SANDBOX === "1") args.unshift("--no-sandbox");
  const logFile = path.join(tmp, "browser.log");
  const child = spawn(path.join(build, "enki-browser"), args, {
    env: { ...process.env, ENKI_BROWSER_USER_DATA: path.join(tmp, "data") }, stdio: ["ignore", openSync(logFile, "w"), openSync(logFile, "a")], detached: true,
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const gone = new Promise((r) => child.once("exit", r));
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    if (await Promise.race([gone.then(() => true), sleep(8000).then(() => false)])) return;
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
  };
  const cdpJson = (p) => fetch(`http://127.0.0.1:${port}${p}`).then((r) => r.json());
  let searched = false;
  try {
    let version;
    for (let i = 0; i < 60 && !version; i++) { await sleep(500); version = await cdpJson("/json/version").catch(() => undefined); }
    if (!version) { check("network hosts: browser started", false, readFileSync(logFile, "utf8").split("\n").slice(-5).join(" | ")); return; }
    const { chromium } = await import("playwright-core");
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const ctx = browser.contexts()[0];
    // First run: Shield fetches its phishing list on install; the extensions settle; then idle.
    const ids = JSON.parse(readFileSync(path.join(build, "version.json"), "utf8"));
    for (let i = 0; i < 40; i++) {
      const t = await cdpJson("/json/list").catch(() => []);
      if (t.some((x) => x.url.startsWith(`chrome-extension://${ids.shieldExtensionId}/`)) && t.some((x) => x.url.startsWith(`chrome-extension://${ids.enkiExtensionId}/`))) break;
      await sleep(500);
    }
    await sleep(Number(process.env.ENKI_NETWORK_IDLE_MS ?? 20000));
    const page = await ctx.newPage();
    await page.goto(`${local}/one`); await page.click("a"); await page.waitForURL(/\/two$/); await sleep(1500);
    check("network hosts: local pages opened", (await page.title()) === "Two");
    // Everything from here on is after an action of the user's.
    await page.goto(`${MARK}user`).catch(() => {});
    let hasXdotool = false;
    try { execSync("command -v xdotool", { stdio: "ignore", shell: "/bin/bash" }); hasXdotool = true; } catch {}
    if (hasXdotool) {
      await page.bringToFront();
      execSync(`xdotool search --sync --onlyvisible --class enki-browser windowactivate --sync 2>/dev/null; sleep 0.5; xdotool key ctrl+l; sleep 0.5; xdotool type --delay 20 "enki network test"; sleep 1; xdotool key Return`, { shell: "/bin/bash" });
      for (let i = 0; i < 20 && !searched; i++) { await sleep(500); searched = (await cdpJson("/json/list").catch(() => [])).some((x) => /duckduckgo\.com\/\?q=enki/.test(x.url)); }
      check("network hosts: the address-bar search went to DuckDuckGo", searched);
      await sleep(3000);
    } else console.log("SKIP network hosts: address-bar search (xdotool not installed)");
    // Closing through DevTools lets Chromium finish the net log.
    await browser.newBrowserCDPSession().then((s) => s.send("Browser.close")).catch(() => {});
    for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) await sleep(500);
  } finally {
    await stop();
    catchAll.close(); pages.close();
  }
  try {
    const text = existsSync(netlog) ? readFileSync(netlog, "utf8") : "";
    const { hosts, events, marks } = hostsFromNetLog(text, MARK);
    const userAt = marks.get(`${MARK}user`) ?? Infinity;
    check("network hosts: the net log recorded the session", events > 100 && Number.isFinite(userAt), `${events} events`);
    const seen = [...hosts].sort((a, b) => a[1] - b[1]);
    console.log(`hosts attempted (${seen.length}): ${seen.map(([h, t]) => `${h} (${t < userAt ? "background" : "user"})`).join(", ") || "none"}`);
    console.log(`reached the local catch-all: ${[...answered].sort().join(", ") || "none"}`);
    const all = new Set([...hosts.keys(), ...answered]);
    const unlisted = [...all].filter((h) => !allowed.has(h));
    const early = seen.filter(([h, t]) => t < userAt && allowed.get(h) === "user").map(([h]) => h);
    check("network hosts: every host attempted is listed in PRIVACY.md", unlisted.length === 0, unlisted.join(", "));
    check("network hosts: no host listed as user-only is contacted before the user does anything", early.length === 0, early.join(", "));
    if (searched) check("network hosts: the search reached duckduckgo.com, after the user's Enter", (hosts.get("duckduckgo.com") ?? -1) >= userAt);
  } catch (e) {
    check("network hosts: the net log can be read", false, e.message);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const results = [];
  const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
  if (process.argv.includes("--unit")) checkAllowlist(check);
  else await runNetworkHosts(check);
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed || !results.length ? 1 : 0);
}
