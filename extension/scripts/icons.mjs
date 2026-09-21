// Renders the Enki Trust Buddy logo (inline SVG) to the PNG sizes Chrome expects.
// Usage: npm run icons
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#bae6fd"/>
      <stop offset="1" stop-color="#38bdf8"/>
    </linearGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e0f2fe"/>
      <stop offset="1" stop-color="#7dd3fc"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="#0c4a6e"/>
  <circle cx="64" cy="64" r="42" fill="url(#sky)" opacity="0.25"/>
  <path d="M64 18 L100 31 L100 65 C100 88 84 105 64 113 C44 105 28 88 28 65 L28 31 Z"
        fill="#075985" stroke="#7dd3fc" stroke-width="2.5"/>
  <circle cx="64" cy="60" r="19.5" fill="url(#body)"/>
  <circle cx="57" cy="57" r="2.75" fill="#0c4a6e"/>
  <circle cx="71" cy="57" r="2.75" fill="#0c4a6e"/>
  <path d="M55 65.5 Q64 72.5 73 65.5" fill="none" stroke="#0c4a6e" stroke-width="2.25" stroke-linecap="round"/>
  <circle cx="51" cy="63" r="2.25" fill="#fb7185" opacity="0.55"/>
  <circle cx="77" cy="63" r="2.25" fill="#fb7185" opacity="0.55"/>
</svg>`;

await mkdir("public/icons", { recursive: true });
await mkdir("src/assets", { recursive: true });
await writeFile("src/assets/logo.svg", svg);
for (const size of [16, 32, 48, 128]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/icon${size}.png`);
}
console.log("icons written to public/icons");
