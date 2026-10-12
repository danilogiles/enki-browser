// Linux tarball self-update (packaging/linux/enki-update), end to end with a throwaway signing key:
// a fake install of 0.0.1, releases served from a local feed, every refusal Updater.cs makes
// (signature, hash, downgrade) plus Linux's own (platform, tarball contents), and the real switch
// the launcher makes on its next start. No Chromium is needed: chromium/chrome is a stub that
// records how it was started.
//
//   node test/update-linux.mjs
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { symlinkSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = path.join(root, "packaging", "linux");
const tmp = mkdtempSync(path.join(os.tmpdir(), "enki-update-linux-"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const pair = () => generateKeyPairSync("rsa", { modulusLength: 3072 });
const good = pair(), evil = pair();
const pub = path.join(tmp, "test.pub");
writeFileSync(pub, good.publicKey.export({ type: "spki", format: "pem" }));

/** A release folder as build-linux.mjs lays it out, with a stub Chromium. */
function release(dir, version) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "chromium"), { recursive: true });
  mkdirSync(path.join(dir, "config"), { recursive: true });
  mkdirSync(path.join(dir, "extensions", "stub"), { recursive: true });
  for (const f of ["enki-browser", "enki-update"]) { cpSync(path.join(pkgDir, f), path.join(dir, f)); chmodSync(path.join(dir, f), 0o755); }
  writeFileSync(path.join(dir, "config", "flags.txt"), "--no-first-run\n");
  cpSync(pub, path.join(dir, "config", "update-signing.pub"));
  writeFileSync(path.join(dir, "version.json"), JSON.stringify({ enkiBrowser: version, builtAt: `${version}-build` }, null, 2));
  writeFileSync(path.join(dir, "chromium", "chrome"), `#!/bin/sh\necho "${version} $*" >> "$ENKI_TEST_RAN"\n`);
  chmodSync(path.join(dir, "chromium", "chrome"), 0o755);
}
const feed = path.join(tmp, "feed");
mkdirSync(feed);
function tarball(version, { name = `enki-browser-${version}-linux-x64.tar.gz`, inner = version, extra, inside } = {}) {
  const work = path.join(tmp, `pack-${name}`);
  release(path.join(work, "enki-browser"), inner);
  if (extra) extra(work);
  if (inside) inside(path.join(work, "enki-browser"));
  execFileSync("tar", ["-czf", path.join(feed, name), "-C", work, ...(extra ? ["."] : ["enki-browser"])]);
  return name;
}
function manifest(file, body, key = good.privateKey) {
  const bytes = Buffer.from(JSON.stringify(body, null, 2) + "\n");
  writeFileSync(path.join(feed, file), bytes);
  writeFileSync(path.join(feed, `${file}.sig`), sign("sha256", bytes, key).toString("base64") + "\n");
}

// The feed runs in its own process: the checks below block this one (spawnSync) while it answers.
const serverJs = `const fs=require("fs"),p=require("path"),http=require("http");
http.createServer((q,s)=>{const f=p.join(${JSON.stringify(feed)},p.basename(decodeURIComponent(q.url)));
if(!fs.existsSync(f)){s.writeHead(404);return s.end();}s.writeHead(200);s.end(fs.readFileSync(f));})
.listen(0,"127.0.0.1",function(){console.log(this.address().port)});`;
const server = spawn(process.execPath, ["-e", serverJs], { stdio: ["ignore", "pipe", "inherit"] });
const port = await new Promise((r) => server.stdout.once("data", (d) => r(Number(String(d).trim()))));
const base = `http://127.0.0.1:${port}`;
const url = (f) => `${base}/${f}`;

const home = path.join(tmp, "home");
const install = path.join(home, ".local", "opt", "enki-browser");
const ran = path.join(tmp, "ran.log");
const env = (feedFile, extra = {}) => ({
  ...process.env, HOME: home, XDG_STATE_HOME: path.join(home, "state"), XDG_CONFIG_HOME: path.join(home, "config"),
  XDG_CACHE_HOME: path.join(home, "cache"), ENKI_BROWSER_UPDATE_FEED: url(feedFile), ENKI_TEST: "1", ENKI_TEST_RAN: ran, ...extra,
});
const updater = (feedFile, extra) => spawnSync(path.join(install, "enki-update"), ["check", "--force"], { env: env(feedFile, extra), encoding: "utf8" });
const version = (dir) => existsSync(path.join(dir, "version.json")) ? JSON.parse(readFileSync(path.join(dir, "version.json"), "utf8")).enkiBrowser : null;
const staged = () => version(`${install}.staged`);
const fresh = () => { release(install, "0.0.1"); rmSync(`${install}.staged`, { recursive: true, force: true }); rmSync(`${install}.previous`, { recursive: true, force: true }); };

// ---- refusals: each leaves nothing staged
const good2 = tarball("0.0.2");
const refusals = [
  ["a manifest signed with another key", () => manifest("evil.json", { version: "0.0.2", platform: "linux-x64", url: url(good2), sha256: sha(path.join(feed, good2)) }, evil.privateKey), "evil.json", /signature is invalid/],
  ["a manifest edited after signing", () => {
    manifest("edited.json", { version: "0.0.2", platform: "linux-x64", url: url(good2), sha256: sha(path.join(feed, good2)) });
    writeFileSync(path.join(feed, "edited.json"), readFileSync(path.join(feed, "edited.json"), "utf8").replace("0.0.2", "0.0.9"));
  }, "edited.json", /signature is invalid/],
  ["the Windows manifest (no platform)", () => manifest("win.json", { version: "0.0.2", url: url(good2), sha256: sha(path.join(feed, good2)) }), "win.json", /not linux-x64/],
  ["a tarball whose hash differs from the signed one", () => manifest("hash.json", { version: "0.0.2", platform: "linux-x64", url: url(good2), sha256: "0".repeat(64) }), "hash.json", /does not match the signed manifest/],
  ["a signed tarball holding another version", () => { const t = tarball("0.0.3", { name: "liar.tar.gz", inner: "0.0.2" }); manifest("liar.json", { version: "0.0.3", platform: "linux-x64", url: url(t), sha256: sha(path.join(feed, t)) }); }, "liar.json", /does not contain version 0.0.3/],
  ["a signed tarball with entries outside enki-browser/", () => { const t = tarball("0.0.2", { name: "slip.tar.gz", extra: (w) => writeFileSync(path.join(w, "evil.sh"), "x") }); manifest("slip.json", { version: "0.0.2", platform: "linux-x64", url: url(t), sha256: sha(path.join(feed, t)) }); }, "slip.json", /outside enki-browser/],
  ["a signed tarball with a symlink to ~/.bashrc", () => { const t = tarball("0.0.2", { name: "bashrc.tar.gz", inside: (d) => symlinkSync(path.join(home, ".bashrc"), path.join(d, "bashrc")) }); manifest("bashrc.json", { version: "0.0.2", platform: "linux-x64", url: url(t), sha256: sha(path.join(feed, t)) }); }, "bashrc.json", /link to .*\.bashrc/],
  ["a signed tarball with a link that climbs out with ..", () => { const t = tarball("0.0.2", { name: "climb.tar.gz", inside: (d) => symlinkSync("../../.bashrc", path.join(d, "climb")) }); manifest("climb.json", { version: "0.0.2", platform: "linux-x64", url: url(t), sha256: sha(path.join(feed, t)) }); }, "climb.json", /link to '\.\.\/\.\.\/\.bashrc'/],
  ["a signed manifest pointing at a plain-http download", () => manifest("plain.json", { version: "0.0.2", platform: "linux-x64", url: `http://example.org/${good2}`, sha256: sha(path.join(feed, good2)) }), "plain.json", /malformed/],
];
for (const [name, setup, file, expect] of refusals) {
  fresh(); setup();
  const r = updater(file);
  check(`refuses ${name}`, r.status !== 0 && expect.test(r.stderr) && staged() === null && version(install) === "0.0.1", r.stderr.trim());
}
fresh();
manifest("old.json", { version: "0.0.1", platform: "linux-x64", url: url(good2), sha256: sha(path.join(feed, good2)) });
let r = updater("old.json");
check("never installs a version that is not newer (no downgrade, no reinstall)", r.status === 0 && /up to date/.test(r.stdout) && staged() === null, r.stdout.trim());

// ---- the feed can only be changed by the test suite
fresh();
manifest("update-linux.json", { version: "0.0.2", platform: "linux-x64", url: url(good2), sha256: sha(path.join(feed, good2)) });
r = updater("update-linux.json", { ENKI_TEST: "", ENKI_BROWSER_UPDATE_FEED: url("update-linux.json"), XDG_STATE_HOME: path.join(home, "state"), https_proxy: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9" });
check("without ENKI_TEST the feed override is ignored and GitHub is used", staged() === null && /ignoring ENKI_BROWSER_UPDATE_FEED/.test(readFileSync(path.join(home, "state", "enki-browser", "update", "update.log"), "utf8")), (r.stderr || "").trim());

// ---- off switches
manifest("update-linux.json", { version: "0.0.2", platform: "linux-x64", url: url(good2), sha256: sha(path.join(feed, good2)) });
fresh(); writeFileSync(path.join(install, "no-update"), "");
r = updater("update-linux.json");
check("a no-update file turns updates off", r.status === 0 && staged() === null, r.stdout.trim());
fresh();
r = updater("update-linux.json", { ENKI_BROWSER_NO_UPDATE: "1" });
check("ENKI_BROWSER_NO_UPDATE=1 turns updates off", r.status === 0 && staged() === null, r.stdout.trim());
fresh(); writeFileSync(path.join(install, "portable"), "");
r = updater("update-linux.json");
check("a portable copy is left alone (its profile lives in the folder)", r.status === 0 && staged() === null, r.stdout.trim());
fresh(); chmodSync(install, 0o555);
r = updater("update-linux.json");
chmodSync(install, 0o755);
check("an install the user cannot write (like the .deb's /opt) is left to the package manager", r.status === 0 && staged() === null, r.stdout.trim());

// ---- the real update
fresh();
r = updater("update-linux.json");
check("stages a signed, newer release beside the install", r.status === 0 && staged() === "0.0.2" && version(install) === "0.0.1", r.stdout.trim() || r.stderr.trim());
r = spawnSync(path.join(install, "enki-browser"), ["https://example.org/"], { env: env("update-linux.json", { ENKI_BROWSER_NO_UPDATE: "" }), encoding: "utf8" });
const log = existsSync(ran) ? readFileSync(ran, "utf8") : "";
check("the next start switches to it and starts the new Chromium with the same arguments",
  version(install) === "0.0.2" && /^0\.0\.2 .*https:\/\/example\.org\/$/m.test(log) && !/^0\.0\.1/m.test(log), log.trim() || r.stderr.trim());
check("the old version is kept as the way back, nothing is left staged", version(`${install}.previous`) === "0.0.1" && staged() === null);
check("the update log says what happened", /switched from 0\.0\.1 to 0\.0\.2/.test(readFileSync(path.join(home, "state", "enki-browser", "update", "update.log"), "utf8")));

// ---- an open browser keeps its version
fresh();
updater("update-linux.json");
const sleeper = path.join(install, "chromium", "chrome");
cpSync("/bin/sleep", sleeper); // a binary, as Chromium is: its command line starts with its own path
const busy = spawn(sleeper, ["30"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 300));
spawnSync(path.join(install, "enki-update"), ["apply"], { env: env("update-linux.json") });
check("while this browser is open, nothing is switched", version(install) === "0.0.1" && staged() === "0.0.2");
busy.kill();

// ---- the release manifest build/sign-update.mjs writes is the one enki-update accepts
const signDir = path.join(tmp, "sign");
mkdirSync(signDir);
cpSync(path.join(feed, good2), path.join(signDir, good2));
const keyFile = path.join(tmp, "test.key");
writeFileSync(keyFile, good.privateKey.export({ type: "pkcs8", format: "pem" }));
execFileSync(process.execPath, [path.join(root, "build", "sign-update.mjs"), path.join(signDir, good2), url(good2)], {
  env: { ...process.env, UPDATE_SIGNING_KEY_FILE: keyFile, UPDATE_PUBLIC_KEY_FILE: pub }, stdio: "ignore",
});
const signed = JSON.parse(readFileSync(path.join(signDir, "update-linux.json"), "utf8"));
check("sign-update.mjs writes update-linux.json for the tarball (platform linux-x64, its SHA-256)",
  signed.platform === "linux-x64" && signed.version === "0.0.2" && signed.sha256 === sha(path.join(feed, good2)) && !existsSync(path.join(signDir, "update.json")));
cpSync(path.join(signDir, "update-linux.json"), path.join(feed, "ci.json"));
cpSync(path.join(signDir, "update-linux.json.sig"), path.join(feed, "ci.json.sig"));
fresh();
r = updater("ci.json");
check("enki-update accepts the manifest sign-update.mjs signed", r.status === 0 && staged() === "0.0.2", r.stderr.trim());

// ---- the same key signs Windows' update.json; enki-update must refuse it
const winZip = path.join(signDir, "EnkiBrowser-0.0.2-windows-x64.zip");
cpSync(path.join(feed, good2), winZip);
execFileSync(process.execPath, [path.join(root, "build", "sign-update.mjs"), winZip, url(good2)], {
  env: { ...process.env, UPDATE_SIGNING_KEY_FILE: keyFile, UPDATE_PUBLIC_KEY_FILE: pub }, stdio: "ignore",
});
const winSigned = JSON.parse(readFileSync(path.join(signDir, "update.json"), "utf8"));
cpSync(path.join(signDir, "update.json"), path.join(feed, "winci.json"));
cpSync(path.join(signDir, "update.json.sig"), path.join(feed, "winci.json.sig"));
fresh();
r = updater("winci.json");
check("refuses the Windows update.json sign-update.mjs signed with the same key (platform win-x64)",
  winSigned.platform === "win-x64" && r.status !== 0 && /not linux-x64/.test(r.stderr) && staged() === null && version(install) === "0.0.1", r.stderr.trim());

server.kill();
rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
