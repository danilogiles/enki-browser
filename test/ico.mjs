// Checks the Windows icon builder (build/ico.mjs): small frames are uncompressed 32-bit DIBs whose
// pixels match the PNG they came from, only 256 px stays PNG. Runs anywhere (no Windows needed);
// on Windows after a build it also reads the enki.ico that ships in out/EnkiBrowser.
//
//   node test/ico.mjs
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { decodePng, pngsToIco, readIco } from "../build/ico.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** The RGBA of DIB frame pixel (x, y), y counted from the top. */
function dibPixel(frame, x, y) {
  const { width, height } = frame;
  const o = 40 + ((height - 1 - y) * width + x) * 4;
  return [frame.data[o + 2], frame.data[o + 1], frame.data[o], frame.data[o + 3]];
}
function maskBit(frame, x, y) {
  const { width, height } = frame;
  const stride = Math.ceil(width / 32) * 4;
  const mask = frame.data.subarray(40 + width * height * 4);
  return (mask[(height - 1 - y) * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
}

/** Every frame below 256 px is a 32-bit BI_RGB DIB of the right size; 256 is a PNG. */
function framesOk(frames, label) {
  const bad = [];
  for (const f of frames) {
    if (f.width >= 256) { if (f.format !== "png") bad.push(`${f.width}: ${f.format}, expected png`); continue; }
    if (f.format !== "dib") { bad.push(`${f.width}: ${f.format}, expected an uncompressed DIB`); continue; }
    const d = f.dib;
    const expected = 40 + f.width * f.height * 4 + Math.ceil(f.width / 32) * 4 * f.height;
    if (d.width !== f.width || d.height !== f.height * 2 || d.bits !== 32 || d.compression !== 0 || f.bits !== 32 || f.data.length !== expected)
      bad.push(`${f.width}: ${JSON.stringify(d)}, ${f.data.length} bytes`);
  }
  check(`${label}: frames below 256 px are 32-bit DIBs, 256 px is PNG`, bad.length === 0 && frames.some((f) => f.width >= 256),
    bad.join("; ") || frames.map((f) => `${f.width}:${f.format}`).join(" "));
}

// ---- synthetic icons in every PNG flavour image tools write
const art = (s) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 32 32">
  <rect x="2" y="2" width="28" height="28" rx="6" fill="#1e1e1e"/><path d="M16 5l9 4v7c0 6-4 10-9 12-5-2-9-6-9-12V9z" fill="#4fb3ff" fill-opacity="0.8"/></svg>`);
const flavours = {
  rgba8: (img) => img.png(),
  rgba16: (img) => img.toColourspace("rgb16").png(),
  palette: (img) => img.png({ palette: true, colours: 16 }),
  grayAlpha: (img) => img.toColourspace("b-w").png(),
  rgbOpaque: (img) => img.flatten({ background: "#ffffff" }).png(),
};
for (const [name, encode] of Object.entries(flavours)) {
  const sizes = [16, 24, 32, 48, 128, 256];
  const pngs = await Promise.all(sizes.map((s) => encode(sharp(art(s))).toBuffer()));
  const frames = readIco(pngsToIco(pngs));
  framesOk(frames, name);
  check(`${name}: one frame per size, smallest first`, frames.map((f) => f.width).join() === sizes.join(), frames.map((f) => f.width).join());
  // Pixels: what Windows reads from the DIB is what sharp reads from the PNG.
  let mismatch = null, maskWrong = null;
  for (const [i, s] of sizes.entries()) {
    if (s >= 256) continue;
    const { data } = await sharp(pngs[i]).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const f = frames[i];
    for (let y = 0; y < s && !mismatch; y++) for (let x = 0; x < s && !mismatch; x++) {
      const o = (y * s + x) * 4;
      const want = [data[o], data[o + 1], data[o + 2], data[o + 3]], got = dibPixel(f, x, y);
      if (want.some((v, k) => Math.abs(v - got[k]) > 1)) mismatch = `${s}px (${x},${y}) want ${want} got ${got}`;
      if ((want[3] === 0) !== (maskBit(f, x, y) === 1)) maskWrong = `${s}px (${x},${y}) alpha ${want[3]}`;
    }
  }
  check(`${name}: DIB pixels match the PNG, transparent pixels are masked`, !mismatch && !maskWrong, mismatch ?? maskWrong ?? "");
}

// ---- the decoder on its own: a low-bit palette and a 16-bit gray PNG
{
  const bw = await sharp(art(16)).threshold(128).png({ palette: true, colours: 2 }).toBuffer();
  const d = decodePng(bw);
  const { data } = await sharp(bw).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  check("decoder: low-bit palette PNGs decode to the same pixels", d.width === 16 && d.rgba.equals(data), `bit depth ${bw[24]}`);
  const g16 = await sharp(art(24)).grayscale().toColourspace("grey16").png().toBuffer();
  const d16 = decodePng(g16);
  check("decoder: 16-bit PNGs decode", d16.width === 24 && d16.rgba.length === 24 * 24 * 4, `bit depth ${g16[24]}`);
}

// ---- the icon set the build uses today (Enki's icons) and, after a Windows build, the shipped enki.ico
{
  const dir = path.join(root, "extension", "public", "icons");
  const pngs = [16, 32, 48, 128, 256].map((s) => path.join(dir, `icon${s}.png`)).filter(existsSync).map((f) => readFileSync(f));
  framesOk(readIco(pngsToIco(pngs)), "Enki's icon set");
}
const built = path.join(root, "out", "EnkiBrowser", "app");
if (existsSync(built)) {
  for (const v of readdirSync(built)) {
    const ico = path.join(built, v, "enki.ico");
    if (existsSync(ico)) framesOk(readIco(readFileSync(ico)), `out/EnkiBrowser/app/${v}/enki.ico`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
