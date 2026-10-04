// What the Windows and Linux builds share: pinned downloads, Enki and the built-in extensions with
// fixed ids, the Enki Browser name in Chromium's UI, and the first-run defaults.
import { createHash, createPublicKey } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebrandLocales } from "./rebrand.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const upstream = JSON.parse(readFileSync(path.join(root, "upstream.json"), "utf8"));
export const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
// Tests build throwaway versions and sign them with a throwaway key; releases use neither override.
if (process.env.ENKI_VERSION) pkg.version = process.env.ENKI_VERSION;
export const cache = path.join(root, "cache");
export const out = path.join(root, "out");

export const step = (msg) => console.log(`\n▸ ${msg}`);
export const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });

export function hash(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export async function fetchPinned({ name, url, sha256 }) {
  mkdirSync(cache, { recursive: true });
  const file = path.join(cache, path.basename(new URL(url).pathname));
  if (!existsSync(file) || hash(file) !== sha256) {
    console.log(`  downloading ${name} from ${url}`);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status} for ${url}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  } else {
    console.log(`  ${name}: using cached ${path.basename(file)}`);
  }
  // A mismatch is never "close enough": it is a different file than the one that was reviewed.
  const actual = hash(file);
  if (actual !== sha256) {
    rmSync(file);
    throw new Error(`${name}: sha256 mismatch.\n  expected ${sha256}\n  got      ${actual}`);
  }
  console.log(`  ${name}: sha256 verified`);
  return file;
}

/**
 * Unpacks a .zip or .tar.xz. On Windows, its own bsdtar handles zip; a GNU tar from Git or MSYS
 * earlier on PATH does not, and mistakes "C:" for a remote host, so its path is fixed. On Linux,
 * unzip and tar do.
 */
export function extract(archive, dest) {
  mkdirSync(dest, { recursive: true });
  if (process.platform === "win32") {
    run(path.join(process.env.WINDIR ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", archive, "-C", dest]);
  } else if (archive.endsWith(".zip")) {
    run("unzip", ["-q", "-o", archive, "-d", dest]);
  } else {
    run("tar", ["-xf", archive, "-C", dest]);
  }
}

/** Archives often wrap everything in one top-level folder; return the folder that holds `marker`. */
export function findRoot(dir, marker) {
  if (existsSync(path.join(dir, marker))) return dir;
  for (const entry of readdirSync(dir)) {
    const sub = path.join(dir, entry);
    if (statSync(sub).isDirectory() && existsSync(path.join(sub, marker))) return sub;
  }
  throw new Error(`Could not find ${marker} under ${dir}`);
}

export function buildEnki() {
  if (process.env.ENKI_DIST) {
    const dist = path.resolve(process.env.ENKI_DIST);
    if (!existsSync(path.join(dist, "manifest.json"))) throw new Error(`ENKI_DIST has no manifest.json: ${dist}`);
    console.log(`  using ENKI_DIST=${dist}`);
    return dist;
  }
  const src = path.join(cache, "enki-src");
  rmSync(src, { recursive: true, force: true });
  run("git", ["clone", "--depth", "1", "--branch", upstream.enki.ref, upstream.enki.repo, src]);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["ci"], { cwd: src, shell: true });
  run(npm, ["run", "build"], { cwd: src, shell: true });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: src }).toString().trim();
  console.log(`  built Enki at ${commit}`);
  return path.join(src, "dist");
}

/**
 * An unpacked extension's id is derived from its folder path, so it would change with every
 * install location — and with it the storage that holds the user's settings, and any way to pin
 * it. Giving the manifest a fixed public key makes the id the same everywhere. Only the public
 * half exists; unpacked extensions are never signed, so there is no private key to protect.
 */
export function extensionIdFromKey(keyB64) {
  const der = Buffer.from(keyB64, "base64");
  const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

function withKey(dir, keyFile, extra = {}) {
  const key = readFileSync(path.join(root, "config", keyFile), "utf8").trim();
  createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" }); // must be a real key
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = { ...JSON.parse(readFileSync(manifestPath, "utf8")), key, ...extra };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { id: extensionIdFromKey(key), manifest };
}

/** Copies the built-in extensions into <app>/extensions and returns their ids. */
export async function addExtensions(app) {
  step(`Fetching ${upstream.blocker.name} ${upstream.blocker.version}`);
  const blockerZip = await fetchPinned(upstream.blocker);
  const blockerTmp = path.join(out, "_blocker");
  extract(blockerZip, blockerTmp);
  cpSync(findRoot(blockerTmp, "manifest.json"), path.join(app, "extensions", "ublock-lite"), { recursive: true });
  rmSync(blockerTmp, { recursive: true, force: true });

  step("Building Enki");
  const enkiDir = path.join(app, "extensions", "enki");
  cpSync(buildEnki(), enkiDir, { recursive: true });
  // Enki ships Enki Home but leaves the new tab alone, so people who install the extension in
  // their own browser keep theirs. In Enki Browser it is the start page.
  const homePage = "src/home/index.html";
  const hasHome = existsSync(path.join(enkiDir, homePage));
  const enki = withKey(enkiDir, "enki-extension.pub", hasHome ? { chrome_url_overrides: { newtab: homePage } } : {});
  console.log(hasHome ? "  Enki Home is the new tab page" : "  this Enki has no Enki Home; keeping Chromium's new tab page");
  console.log(`  Enki extension id: ${enki.id} (Enki ${enki.manifest.version})`);

  // Enki Shield, with a fixed id like Enki's so its downloaded list survives reinstalls.
  const shieldDir = path.join(app, "extensions", "shield");
  cpSync(path.join(root, "shield"), shieldDir, { recursive: true });
  const shield = withKey(shieldDir, "shield-extension.pub");
  console.log(`  Enki Shield id: ${shield.id}`);

  // Icons up to 256 px live in icons/ (older Enki builds only had public/icons up to 128).
  const iconDir = existsSync(path.join(enkiDir, "icons", "icon16.png")) ? path.join(enkiDir, "icons") : path.join(enkiDir, "public", "icons");
  return { enkiId: enki.id, enkiVersion: enki.manifest.version, shieldId: shield.id, iconDir };
}

/** "Chromium" becomes "Enki Browser" across the UI, in every language. */
export function rebrand(chromiumDir) {
  const counts = Object.values(rebrandLocales(path.join(chromiumDir, "locales"), "Enki Browser"));
  console.log(`  renamed Chromium → Enki Browser in ${counts.reduce((a, b) => a + b, 0)} strings across ${counts.length} languages`);
}

/** First-run defaults (read from next to the Chromium binary) and the launcher's switches. */
export function writeDefaults(chromiumDir, configDir, enkiId) {
  const prefs = JSON.parse(readFileSync(path.join(root, "config", "initial_preferences.json"), "utf8"));
  prefs.extensions = { ...(prefs.extensions ?? {}), pinned_extensions: [enkiId] };
  writeFileSync(path.join(chromiumDir, "initial_preferences"), JSON.stringify(prefs, null, 2));
  mkdirSync(configDir, { recursive: true });
  cpSync(path.join(root, "config", "flags.txt"), path.join(configDir, "flags.txt"));
}

export function versionInfo(extra) {
  return { enkiBrowser: pkg.version, ...extra, builtAt: new Date().toISOString() };
}
