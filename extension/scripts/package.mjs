// Zips dist/ into release/enki-v<version>.zip for the Chrome Web Store.
// Usage: npm run package
//
// The archive is written with Node's zlib rather than by shelling out to `tar` or `zip`:
// those differ across platforms (GNU tar cannot write zip, and it reads a Windows "C:\..."
// path as a remote host), so building the container here keeps the output identical everywhere.
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { deflateRawSync } from "node:zlib";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));
const version = pkg.version || "0.1.0";
const distDir = resolve("./dist");
const outputDir = resolve("./release");
const zipPath = resolve(outputDir, `enki-v${version}.zip`);

if (!existsSync(distDir)) {
  console.error("Error: dist/ not found. Run 'npm run build' first.");
  process.exit(1);
}
if (!existsSync(join(distDir, "manifest.json"))) {
  console.error("Error: dist/manifest.json missing — the build did not produce a loadable extension.");
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Fixed DOS timestamp so repeated builds of the same output produce the same bytes. */
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1980-01-01

const files = walk(distDir).sort();
const locals = [];
const central = [];
let offset = 0;

for (const file of files) {
  // Zip entries always use forward slashes, whatever the host separator is.
  const name = Buffer.from(relative(distDir, file).split(sep).join("/"), "utf8");
  const raw = readFileSync(file);
  const deflated = deflateRawSync(raw, { level: 9 });
  // Fall back to storing when compression would make the entry bigger.
  const useDeflate = deflated.length < raw.length;
  const data = useDeflate ? deflated : raw;
  const method = useDeflate ? 8 : 0;
  const crc = crc32(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x800, 6); // UTF-8 names
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, name, data);

  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0);
  dir.writeUInt16LE(20, 4); // version made by
  dir.writeUInt16LE(20, 6); // version needed
  dir.writeUInt16LE(0x800, 8);
  dir.writeUInt16LE(method, 10);
  dir.writeUInt16LE(DOS_TIME, 12);
  dir.writeUInt16LE(DOS_DATE, 14);
  dir.writeUInt32LE(crc, 16);
  dir.writeUInt32LE(data.length, 20);
  dir.writeUInt32LE(raw.length, 24);
  dir.writeUInt16LE(name.length, 28);
  dir.writeUInt32LE(offset, 42);
  central.push(dir, name);

  offset += local.length + name.length + data.length;
}

const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(outputDir, { recursive: true });
writeFileSync(zipPath, Buffer.concat([...locals, centralBuf, end]));

const sizeKb = (statSync(zipPath).size / 1024).toFixed(1);
console.log(`Packaged Enki v${version}: ${files.length} files`);
console.log(`✓ release/enki-v${version}.zip (${sizeKb} KB)`);
console.log("Upload it at https://chrome.google.com/webstore/devconsole");
