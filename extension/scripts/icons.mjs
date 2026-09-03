// Renders the Enki logo (inline SVG) to the PNG sizes Chrome expects.
// Usage: npm run icons
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22d3ee"/>
      <stop offset="1" stop-color="#2dd4bf"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="#0b1220"/>
  <rect x="24" y="30" width="12" height="68" rx="6" fill="url(#g)"/>
  <path d="M36 36 C48 26 58 46 70 36 S92 26 102 36" stroke="url(#g)" stroke-width="12" fill="none" stroke-linecap="round"/>
  <path d="M36 64 C48 54 58 74 70 64 S84 54 92 64" stroke="url(#g)" stroke-width="12" fill="none" stroke-linecap="round"/>
  <path d="M36 92 C48 82 58 102 70 92 S92 82 102 92" stroke="url(#g)" stroke-width="12" fill="none" stroke-linecap="round"/>
</svg>`;

await mkdir("public/icons", { recursive: true });
await mkdir("src/assets", { recursive: true });
await writeFile("src/assets/logo.svg", svg);
for (const size of [16, 32, 48, 128]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/icon${size}.png`);
}
console.log("icons written to public/icons");
