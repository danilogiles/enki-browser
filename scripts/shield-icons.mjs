// Renders Enki Shield's toolbar icon (shield/icons/shield*.png) from one SVG. Run after editing it.
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "shield", "icons");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#0369a1"/></linearGradient></defs>
  <path d="M64 6 L112 22 V58 C112 90 92 110 64 122 C36 110 16 90 16 58 V22 Z" fill="url(#g)" stroke="#0c4a6e" stroke-width="4" stroke-linejoin="round"/>
  <path d="M42 64 L57 79 L88 46" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
for (const size of [16, 32, 48, 128]) await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(dir, `shield${size}.png`));
console.log("rendered", dir);
