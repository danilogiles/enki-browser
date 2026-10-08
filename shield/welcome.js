// The one-time default browser page (default-browser.js decides when it opens).
import { defaultStatus, openDefaultApps } from "./default-browser.js";
import { native } from "./updates.js";

const $ = (id) => document.getElementById(id);
const state = $("state");

async function refresh() {
  const s = await defaultStatus(native);
  if (s?.isDefault) {
    $("title").textContent = "Enki Browser is your default browser";
    $("text").textContent = "Links from other apps now open here.";
    state.textContent = "";
    $("open-settings").hidden = true;
    $("not-now").textContent = "Close";
  }
}

$("open-settings").addEventListener("click", async () => {
  state.textContent = (await openDefaultApps(native))
    ? "In Settings, choose Enki Browser, then “Set default” (on Windows 10: Web browser → Enki Browser)."
    : "Windows Settings could not be opened. Open Settings → Apps → Default apps and choose Enki Browser.";
});
$("not-now").addEventListener("click", () => window.close());
// Back from Settings: say so when it worked.
window.addEventListener("focus", () => void refresh());
await refresh();
document.documentElement.dataset.ready = "true";
