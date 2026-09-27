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
 * chromium.org, Chromium/…, Chromium_… and "Chromium OS" (a different product) stay as they are.
 */
const PRODUCT = /(?<![\w./-])Chromium(?![\w/-]|\.\w| OS\b)/g;

/** Rewrites one locale pak in place. Returns how many strings changed. */
export function rebrandPak(file, name) {
  const pak = readPak(readFileSync(file));
  if (pak.encoding !== 1) return 0; // locale paks are UTF-8; anything else is not ours to edit
  let changed = 0;
  for (const r of pak.resources) {
    if (r.data.length < 8 || COMPRESSED(r.data)) continue;
    const text = r.data.toString("utf8");
    if (!text.includes("Chromium")) continue;
    const next = text.replace(PRODUCT, name);
    if (next !== text) {
      r.data = Buffer.from(next, "utf8");
      changed++;
    }
  }
  if (changed) writeFileSync(file, writePak(pak));
  return changed;
}

export function rebrandLocales(localesDir, name) {
  const report = {};
  for (const f of readdirSync(localesDir).filter((f) => f.endsWith(".pak"))) {
    report[f] = rebrandPak(path.join(localesDir, f), name);
  }
  return report;
}
