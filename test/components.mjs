// PRIVACY.md's "Built-in components" table must say exactly what ships: each built-in extension,
// its permissions, and nothing hidden. Also pins the launcher's native messaging host to Shield.
//
//   node test/components.mjs                  sources only (no build needed)
//   ENKI_LINUX_DIR=… node test/components.mjs  also the manifests of a built Linux install
//   ENKI_APP_DIR=…   node test/components.mjs  same, any platform's app folder (where version.json is)
//
// verify.mjs imports checkComponents() for the built-app half, and checks chrome://extensions itself.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(path.join(root, f), "utf8");

// The folder under <app>/extensions, and the name PRIVACY.md uses.
export const components = [
  { dir: "enki", name: "Enki" },
  { dir: "shield", name: "Enki Shield" },
  { dir: "ublock-lite", name: "uBlock Origin Lite" },
];

/** { name: { permissions: [...], sites: "..." } } from PRIVACY.md's table. */
export function privacyTable() {
  const text = read("PRIVACY.md");
  const start = text.indexOf("\n## Built-in components\n");
  if (start < 0) throw new Error('PRIVACY.md has no "## Built-in components" section');
  const end = text.indexOf("\n## ", start + 5);
  const rows = text.slice(start, end < 0 ? undefined : end).split("\n").filter((l) => l.startsWith("| ") && !/^\| (Component|---)/.test(l));
  const table = {};
  for (const row of rows) {
    const cells = row.split("|").slice(1, -1).map((c) => c.trim());
    table[cells[0]] = { permissions: [...cells[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]), sites: cells[3] };
  }
  return table;
}

const same = (a, b) => [...a].sort().join(",") === [...b].sort().join(",");
const diff = (doc, real) => {
  const missing = real.filter((p) => !doc.includes(p)), extra = doc.filter((p) => !real.includes(p));
  return [missing.length && `not in PRIVACY.md: ${missing.join(", ")}`, extra.length && `in PRIVACY.md only: ${extra.join(", ")}`].filter(Boolean).join("; ");
};
const allSites = (hosts) => hosts.length === 1 && hosts[0] === "<all_urls>";

/** Enki's manifest is TypeScript (CRXJS); its permission and host lists are plain string arrays. */
function enkiSourceManifest() {
  const src = read("extension/manifest.config.ts");
  const list = (key) => {
    const m = new RegExp(`\\b${key}:\\s*\\[([^\\]]*)\\]`).exec(src);
    if (!m) throw new Error(`extension/manifest.config.ts: no ${key} array`);
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  };
  return { permissions: list("permissions"), host_permissions: list("host_permissions"), optional_permissions: /optional_permissions/.test(src) ? ["(present)"] : [] };
}

/** Checks one manifest against its PRIVACY.md row. */
function checkManifest(check, table, name, manifest, where) {
  const row = table[name];
  if (!row) return check(`PRIVACY.md lists ${name}`, false, "no row");
  const perms = manifest.permissions ?? [];
  check(`PRIVACY.md lists ${name}'s permissions exactly (${where})`, same(row.permissions, perms), diff(row.permissions, perms) || perms.join(", "));
  const optional = [...(manifest.optional_permissions ?? []), ...(manifest.optional_host_permissions ?? [])];
  check(`${name} asks for no optional permissions (${where})`, optional.length === 0, optional.join(", "));
  const hosts = manifest.host_permissions ?? [];
  check(`${name}'s site access matches PRIVACY.md (${where})`, allSites(hosts) ? /^All sites\b/.test(row.sites) : !/^All sites\b/.test(row.sites), hosts.join(", "));
}

/** Source-only checks. */
export function checkSources(check) {
  const table = privacyTable();
  check("PRIVACY.md lists exactly the three built-in components", same(Object.keys(table), components.map((c) => c.name)), Object.keys(table).join(", "));
  checkManifest(check, table, "Enki", enkiSourceManifest(), "source");
  checkManifest(check, table, "Enki Shield", JSON.parse(read("shield/manifest.json")), "source");

  // The native messaging host: one allowed origin, Enki Shield's.
  const host = read("launcher/NativeHost.cs");
  const origins = [...host.matchAll(/"allowed_origins",\s*new\[\]\s*\{([^}]*)\}/g)].map((m) => m[1].trim());
  check("the native messaging host allows only Enki Shield", origins.length === 1 && origins[0] === '"chrome-extension://" + shield + "/"', origins.join(" | ") || "no allowed_origins");
  check("the host's Shield id comes from the build's version.json", /v\["shieldExtensionId"\]/.test(host));
  const shieldManifest = JSON.parse(read("shield/manifest.json"));
  const enki = enkiSourceManifest();
  check("only Enki Shield asks for nativeMessaging (source)", shieldManifest.permissions.includes("nativeMessaging") && !enki.permissions.includes("nativeMessaging"));
}

/** Checks a built app folder (the one holding version.json and extensions/). */
export function checkComponents(check, app) {
  const table = privacyTable();
  const dirs = readdirSync(path.join(app, "extensions")).sort();
  check("the build ships exactly the three built-in extensions", same(dirs, components.map((c) => c.dir)), dirs.join(", "));
  for (const { dir, name } of components) {
    const file = path.join(app, "extensions", dir, "manifest.json");
    if (!existsSync(file)) { check(`${name} is in the build`, false, file); continue; }
    checkManifest(check, table, name, JSON.parse(readFileSync(file, "utf8")), "built");
  }
  const built = (d) => JSON.parse(readFileSync(path.join(app, "extensions", d, "manifest.json"), "utf8")).permissions ?? [];
  const natives = components.filter((c) => built(c.dir).includes("nativeMessaging")).map((c) => c.name);
  check("only Enki Shield asks for nativeMessaging (built)", natives.length === 1 && natives[0] === "Enki Shield", natives.join(", "));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let failed = 0;
  const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
  checkSources(check);
  const app = process.env.ENKI_APP_DIR ?? process.env.ENKI_LINUX_DIR;
  if (app) checkComponents(check, app);
  else console.log("no ENKI_APP_DIR or ENKI_LINUX_DIR: skipped the built manifests (verify.mjs checks them)");
  process.exit(failed ? 1 : 0);
}
