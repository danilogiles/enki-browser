// Puts the Enki Browser name where Chromium's own UI says "Chromium": the window title
// ("$1 - Chromium"), About, the menu, update and restart messages — about 480 strings per
// language. Those strings live in Chromium's locale .pak files, so renaming them needs no
// Chromium build; the file format is small and stable.
//
// .pak v5 (the format Chromium 153 writes):
//   uint32 version=5 · uint8 encoding · 3 bytes padding · uint16 resourceCount · uint16 aliasCount
//   (resourceCount + 1) × { uint16 id, uint32 offset }   — the extra entry marks the end of data
//   aliasCount × { uint16 id, uint16 entryIndex }
//   data
// Offsets are absolute. Rewriting a string changes every later offset, so the file is rebuilt.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Reads a v5 pak into its parts. Throws on anything else rather than guessing. */
export function readPak(buf) {
  const version = buf.readUInt32LE(0);
  if (version !== 5) throw new Error(`unsupported pak version ${version}`);
  const encoding = buf.readUInt8(4);
  const count = buf.readUInt16LE(8);
  const aliasCount = buf.readUInt16LE(10);
  const table = [];
  for (let i = 0; i <= count; i++) table.push({ id: buf.readUInt16LE(12 + i * 6), offset: buf.readUInt32LE(14 + i * 6) });
  const aliasStart = 12 + (count + 1) * 6;
  const aliases = [];
  for (let i = 0; i < aliasCount; i++) aliases.push({ id: buf.readUInt16LE(aliasStart + i * 4), index: buf.readUInt16LE(aliasStart + i * 4 + 2) });
  const resources = [];
  for (let i = 0; i < count; i++) resources.push({ id: table[i].id, data: buf.subarray(table[i].offset, table[i + 1].offset) });
  return { encoding, resources, aliases };
}

export function writePak({ encoding, resources, aliases }) {
  const headerSize = 12 + (resources.length + 1) * 6 + aliases.length * 4;
  const header = Buffer.alloc(headerSize);
  header.writeUInt32LE(5, 0);
  header.writeUInt8(encoding, 4);
  header.writeUInt16LE(resources.length, 8);
  header.writeUInt16LE(aliases.length, 10);
  let offset = headerSize;
  resources.forEach((r, i) => {
    header.writeUInt16LE(r.id, 12 + i * 6);
    header.writeUInt32LE(offset, 14 + i * 6);
    offset += r.data.length;
  });
  // The sentinel entry: id 0, offset = end of data.
  header.writeUInt16LE(0, 12 + resources.length * 6);
  header.writeUInt32LE(offset, 14 + resources.length * 6);
  const aliasStart = 12 + (resources.length + 1) * 6;
  aliases.forEach((a, i) => {
    header.writeUInt16LE(a.id, aliasStart + i * 4);
    header.writeUInt16LE(a.index, aliasStart + i * 4 + 2);
  });
  return Buffer.concat([header, ...resources.map((r) => r.data)]);
}

const COMPRESSED = (d) => (d[0] === 0x1e && d[1] === 0x9b) || (d[0] === 0x1f && d[1] === 0x8b);

/**
 * "Chromium" as the product's name, not as part of an address, file name or identifier:
 * chromium.org, Chromium/…, Chromium_… and "Chromium OS" (a different product) stay as they are,
 * and so does the linked project name in "made possible by the <a>Chromium</a> open source
 * project" — that sentence credits the project Enki Browser is built from.
 */
const PRODUCT = /(?<![\w./>-])Chromium(?![\w/-]|\.\w| OS\b|<\/a>)/g;

/**
 * Strings that credit the Chromium project rather than name the product, found by their English
 * text and left alone in every language (resource ids are the same across a build's locales):
 * "The Chromium Authors", the copyright line, and "…the Chromium open source project".
 */
const CREDITS = /Chromium Authors|Chromium open source project/;

/**
 * The About page's version line, "Version 154.0… (Official Build, …) (64-bit)": Enki Browser's own
 * version goes in front of Chromium's. Matched by its five placeholders, which no other string
 * has; a plain "Version $1" is used elsewhere and is left alone.
 */
const VERSION_LINE = /^Version \$1\$2 +\(\$3\) \$4 \$5$/;

/** Ids to skip and the About version line's id, read from a build's English locale pak. */
export function localeIds(englishPak) {
  const pak = readPak(readFileSync(englishPak));
  const credits = new Set();
  let version = null;
  for (const r of pak.resources) {
    const text = r.data.toString("utf8");
    if (CREDITS.test(text)) credits.add(r.id);
    if (VERSION_LINE.test(text)) version = r.id;
  }
  return { credits, version };
}

/** Rewrites one locale pak in place. Returns how many strings changed. */
export function rebrandPak(file, name, { credits = new Set(), version = null, productVersion = null } = {}) {
  const pak = readPak(readFileSync(file));
  if (pak.encoding !== 1) return 0; // locale paks are UTF-8; anything else is not ours to edit
  let changed = 0;
  for (const r of pak.resources) {
    if (r.data.length < 8 || COMPRESSED(r.data) || credits.has(r.id)) continue;
    const text = r.data.toString("utf8");
    let next = text.includes("Chromium") ? text.replace(PRODUCT, name) : text;
    if (productVersion && r.id === version && text.includes("$1")) next = `${name} ${productVersion} · ${next}`;
    if (next !== text) {
      r.data = Buffer.from(next, "utf8");
      changed++;
    }
  }
  if (changed) writeFileSync(file, writePak(pak));
  return changed;
}

export function rebrandLocales(localesDir, name, productVersion = null) {
  const files = readdirSync(localesDir).filter((f) => f.endsWith(".pak")).map((f) => path.join(localesDir, f));
  return rebrandLocaleFiles(files, path.join(localesDir, "en-US.pak"), name, productVersion);
}

/**
 * The same for locale paks wherever they sit: macOS keeps one per language as
 * <lang>.lproj/locale.pak inside Chromium's framework, rather than a locales/ folder.
 */
export function rebrandLocaleFiles(files, englishPak, name, productVersion = null) {
  const ids = localeIds(englishPak);
  if (productVersion && ids.version === null) throw new Error(`the About page's version line was not found in ${englishPak}`);
  const report = {};
  for (const f of files) report[path.relative(path.dirname(path.dirname(f)), f)] = rebrandPak(f, name, { ...ids, productVersion });
  return report;
}
