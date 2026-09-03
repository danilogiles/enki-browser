import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "Enki",
  version: pkg.version,
  description: pkg.description,
  minimum_chrome_version: "116",
  icons: {
    16: "public/icons/icon16.png",
    32: "public/icons/icon32.png",
    48: "public/icons/icon48.png",
    128: "public/icons/icon128.png",
  },
  action: {
    default_title: "Open Enki",
    default_icon: {
      16: "public/icons/icon16.png",
      32: "public/icons/icon32.png",
    },
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
  commands: {
    "open-panel": {
      suggested_key: { default: "Ctrl+Shift+E", mac: "Command+Shift+E" },
      description: "Open the Enki side panel",
    },
  },
  permissions: [
    "sidePanel",
    "activeTab",
    "tabs",
    "scripting",
    "storage",
    "debugger",
    "webNavigation",
  ],
  host_permissions: ["<all_urls>"],
});
