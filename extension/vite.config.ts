import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import { fileURLToPath, URL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import manifest from "./manifest.config.ts";

const SHIELD_ID = "aacambieennepbgemjkpailjdkldbjjf";

/**
 * CRXJS drops `extension_ids` from web_accessible_resources, which would leave search.html open to
 * no one (matches: []). Put Shield's id back in the written manifest.
 */
function searchPageForShield() {
  return {
    name: "enki-search-war",
    apply: "build" as const,
    writeBundle(opts: { dir?: string }) {
      const file = `${opts.dir ?? "dist"}/manifest.json`;
      const m = JSON.parse(readFileSync(file, "utf8"));
      for (const war of m.web_accessible_resources ?? []) {
        if (war.resources?.includes("search.html")) {
          war.matches = [];
          war.extension_ids = [SHIELD_ID];
        }
      }
      writeFileSync(file, JSON.stringify(m, null, 2));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest }), searchPageForShield()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: "src/sidepanel/index.html",
        // Enki Home. Unused by the extension on its own; Enki Browser makes it the new tab page.
        home: "src/home/index.html",
        // Asks for the microphone once (the side panel cannot show the prompt).
        mic: "src/mic/index.html",
        // AI search from the address bar: chrome-extension://<id>/search.html?q=%s (0.8.9).
        search: "search.html",
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
    cors: { origin: [/chrome-extension:\/\//] },
  },
});
