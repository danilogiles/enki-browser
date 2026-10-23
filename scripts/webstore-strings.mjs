// Copies Ink's words for "Install in Enki" (strings.json: en, pt, es and es_419) into Shield's
// _locales, so new copy is one command, not a hand edit in four files:
//
//   node scripts/webstore-strings.mjs <path to strings.json>
//
// pt goes to pt_BR. {name}, {version}, {from} and {to} become Chrome's named placeholders ($1, $2
// in the order name, version, from, to). es_419 holds only Ink's keys; Chromium takes the rest
// from es. Keys already there are replaced in place, new ones are added at the end; nothing else
// in the files changes. test/shield-webstore-unit.mjs checks that every locale has every key.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORDER = ["name", "version", "from", "to"];
const FOLDERS = { en: "en", pt: "pt_BR", es: "es", es_419: "es_419" };
const NOTE = "Install in Enki (Ink, strings.json; pending Danilo's approval).";

/** One strings.json text → a messages.json entry; placeholders numbered by the English text. */
export function toMessage(text, enText) {
  const used = ORDER.filter((p) => enText.includes(`{${p}}`));
  const unknown = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((p) => !used.includes(p));
  if (unknown.length) throw new Error(`unknown placeholder {${unknown[0]}} in "${text}"`);
  const entry = { message: text.replace(/\{(\w+)\}/g, (_, p) => `$${p.toUpperCase()}$`), description: NOTE };
  if (used.length) entry.placeholders = Object.fromEntries(used.map((p, i) => [p, { content: `$${i + 1}` }]));
  return entry;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = process.argv[2];
  if (!src) throw new Error("usage: node scripts/webstore-strings.mjs <strings.json>");
  const strings = JSON.parse(readFileSync(src, "utf8"));
  const keys = Object.keys(strings.en);
  for (const [lang, folder] of Object.entries(FOLDERS)) {
    if (!strings[lang]) continue;
    const missing = keys.filter((k) => !(k in strings[lang]));
    if (missing.length) throw new Error(`${lang} lacks ${missing.join(", ")}`);
    const file = path.join(root, "shield", "_locales", folder, "messages.json");
    const messages = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    for (const k of keys) messages[k] = toMessage(strings[lang][k], strings.en[k]);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(messages, null, 2)}\n`);
    console.log(`${folder}: ${keys.length} keys`);
  }
}
