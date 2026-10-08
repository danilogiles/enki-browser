// Windows .ico files from PNGs, for EnkiBrowser.exe, the launcher and chrome.exe/chrome.dll.
//
// Frames smaller than 256 px are stored as uncompressed 32-bit DIBs (BGRA with a straight alpha
// channel plus the 1-bit AND mask), and only the 256 px frame as PNG. PNG frames are allowed in an
// .ico since Vista, but Microsoft's guidance is PNG for 256 px only: some shell paths (the "Open
// with" app list, ExtractIconEx and the classic icon cache at small sizes) do not draw small
// PNG-compressed frames and fall back to a blank icon. Until 0.8.5 every frame was a PNG.
//
// Icon-agnostic on purpose: whatever PNG set the build hands in (Enki's icons today, the plated
// brand icons once they replace them) becomes the .ico. Synchronous and dependency-free, so the
// build and the tests can call it directly; the PNG decoder covers what image tools write
// (8- and 16-bit gray, gray+alpha, RGB, RGBA, and 1/2/4/8-bit palettes with tRNS), non-interlaced.
import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decodes a PNG into { width, height, rgba } (straight alpha, 4 bytes per pixel, top row first). */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("not a PNG");
  let width, height, depth, type, interlace, palette = null, trns = null;
  const idat = [];
  for (let at = 8; at < buf.length;) {
    const length = buf.readUInt32BE(at), kind = buf.toString("latin1", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    if (kind === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; type = data[9]; interlace = data[12];
    } else if (kind === "PLTE") palette = data;
    else if (kind === "tRNS") trns = data;
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    at += 12 + length;
  }
  if (interlace) throw new Error("interlaced PNGs are not supported");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`PNG colour type ${type} is not supported`);
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const step = Math.max(1, bitsPerPixel >> 3); // the filter's "bpp": bytes per complete pixel, at least 1
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= step ? out[x - step] : 0, b = up ? up[x] : 0, c = up && x >= step ? up[x - step] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`PNG filter ${filter} is not valid`);
      out[x] = v & 0xff;
    }
  }
  const sample = (row, index) => {
    // The index-th sample of a row, scaled to 8 bits (16-bit samples keep their high byte).
    if (depth === 8) return row[index];
    if (depth === 16) return row[index * 2];
    const perByte = 8 / depth, byte = row[Math.floor(index / perByte)];
    const shift = 8 - depth * ((index % perByte) + 1);
    const v = (byte >> shift) & ((1 << depth) - 1);
    return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (type === 3) {
        const i = sample(row, x);
        rgba[o] = palette[i * 3]; rgba[o + 1] = palette[i * 3 + 1]; rgba[o + 2] = palette[i * 3 + 2];
        rgba[o + 3] = trns && i < trns.length ? trns[i] : 255;
      } else if (type === 0 || type === 4) {
        const g = sample(row, x * channels);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = type === 4 ? sample(row, x * channels + 1) : 255;
      } else {
        for (let k = 0; k < 3; k++) rgba[o + k] = sample(row, x * channels + k);
        rgba[o + 3] = type === 6 ? sample(row, x * channels + 3) : 255;
      }
    }
  }
  return { width, height, rgba };
}

/** One icon frame as a DIB: BITMAPINFOHEADER, BGRA rows bottom-up, then the AND mask (1 = transparent). */
export function dibFrame({ width, height, rgba }) {
  const header = Buffer.alloc(40);
  const maskStride = Math.ceil(width / 32) * 4;
  const xorSize = width * height * 4, maskSize = maskStride * height;
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8); // XOR bitmap and AND mask together
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bits per pixel
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(xorSize + maskSize, 20);
  const xor = Buffer.alloc(xorSize), mask = Buffer.alloc(maskSize);
  for (let y = 0; y < height; y++) {
    const dst = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4, d = (dst * width + x) * 4;
      xor[d] = rgba[s + 2]; xor[d + 1] = rgba[s + 1]; xor[d + 2] = rgba[s]; xor[d + 3] = rgba[s + 3];
      if (rgba[s + 3] === 0) mask[dst * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, xor, mask]);
}

/** Builds an .ico from PNG buffers: 256 px (and larger) frames stay PNG, smaller ones become DIBs. */
export function pngsToIco(pngs) {
  const frames = pngs
    .map((png) => {
      const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
      return { w, h, data: w >= 256 ? png : dibFrame(decodePng(png)) };
    })
    .sort((a, b) => a.w - b.w);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(frames.length, 4);
  const entries = [];
  let offset = 6 + 16 * frames.length;
  for (const f of frames) {
    const e = Buffer.alloc(16);
    e.writeUInt8(f.w >= 256 ? 0 : f.w, 0);
    e.writeUInt8(f.h >= 256 ? 0 : f.h, 1);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(f.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += f.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.data)]);
}

/** Reads an .ico back: each frame's size and format, for the tests and the build's own check. */
export function readIco(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error("not an icon file");
  const frames = [];
  for (let i = 0; i < buf.readUInt16LE(4); i++) {
    const e = 6 + i * 16;
    const size = buf.readUInt32LE(e + 8), offset = buf.readUInt32LE(e + 12);
    const data = buf.subarray(offset, offset + size);
    const png = data.subarray(0, 8).equals(PNG_SIGNATURE);
    frames.push({
      width: buf[e] || 256, height: buf[e + 1] || 256, bits: buf.readUInt16LE(e + 6), data,
      format: png ? "png" : data.readUInt32LE(0) === 40 ? "dib" : "unknown",
      dib: png ? null : { width: data.readInt32LE(4), height: data.readInt32LE(8), bits: data.readUInt16LE(14), compression: data.readUInt32LE(16) },
    });
  }
  return frames;
}
