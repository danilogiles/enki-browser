// Enki Shields' global settings, opened from the panel's "Global settings".
import { t } from "./i18n.js";
import { AUTO_BURN, BADGE, LEVELS, applySites, blocker, forgetList, setForget, setSite, sites } from "./sites.js";
import { DOWNLOAD, check, compare, native, restart, restartWithFallback, status } from "./updates.js";
import { defaultStatus, openDefaultApps } from "./default-browser.js";
import { showWidevine } from "./widevine.js";
import { GPC, gpcOn } from "./gpc.js";
import { renderNotices, renderSettings } from "./webstore-ui.js";

const $ = (id) => document.getElementById(id);

const level = $("level");
level.replaceChildren(...LEVELS.map((l) => Object.assign(document.createElement("option"), { value: l.level, textContent: `${t(`level${l.label}`, l.label)} — ${t(`hint${l.label}`, l.hint)}` })));
const current = await blocker("getDefaultFilteringMode");
level.value = String(typeof current === "number" && current > 0 ? current : 2);
level.disabled = typeof current !== "number";
level.onchange = () => blocker("setDefaultFilteringMode", { level: Number(level.value) });

const badge = $("badge");
badge.setAttribute("aria-checked", String((await chrome.storage.local.get(BADGE))[BADGE] !== false));
badge.onclick = async () => {
  const on = badge.getAttribute("aria-checked") !== "true";
  badge.setAttribute("aria-checked", String(on));
  await chrome.storage.local.set({ [BADGE]: on });
};

// Global Privacy Control (gpc.js applies it when this changes).
const gpc = $("gpc");
gpc.setAttribute("aria-checked", String(await gpcOn()));
gpc.onclick = async () => {
  const on = gpc.getAttribute("aria-checked") !== "true";
  gpc.setAttribute("aria-checked", String(on));
  await chrome.storage.local.set({ [GPC]: on });
};

async function renderSites() {
  const all = await sites();
  const forget = await forgetList();
  const hosts = [...new Set([...Object.keys(all), ...forget])].sort();
  const list = $("sites");
  if (!hosts.length) { list.replaceChildren(Object.assign(document.createElement("li"), { textContent: t("noneYet", "None yet.") })); return; }
  list.replaceChildren(...hosts.map((h) => {
    const s = all[h] ?? {};
    const what = [s.scripts === "block" && t("scriptsBlocked", "scripts blocked"), s.cookies === "block" && t("allCookiesBlocked", "all cookies blocked"), forget.includes(h) && t("forgotten", "forgotten on close")].filter(Boolean).join(", ");
    const li = document.createElement("li");
    const reset = Object.assign(document.createElement("button"), { className: "link", textContent: t("reset", "Reset") });
    reset.onclick = async () => { await setSite(h, { scripts: undefined, cookies: undefined }); await setForget(h, false); await renderSites(); };
    li.append(Object.assign(document.createElement("span"), { textContent: `${h} — ${what}` }), reset);
    return li;
  }));
}
await renderSites();

// Burn: everything now, or every time the browser closes.
const autoBurn = $("auto-burn");
autoBurn.setAttribute("aria-checked", String((await chrome.storage.local.get(AUTO_BURN))[AUTO_BURN] === true));
autoBurn.onclick = async () => {
  const on = autoBurn.getAttribute("aria-checked") !== "true";
  autoBurn.setAttribute("aria-checked", String(on));
  await chrome.storage.local.set({ [AUTO_BURN]: on });
  await applySites(await sites());
};
// Burn now asks in the page, not with confirm(): there OK was the default, so Enter (or a quick
// second click) burned everything. Here Cancel has the focus, so Enter cancels, and so does Esc.
const burnNow = $("burn-now");
const burnConfirm = $("burn-confirm");
const burnCancel = $("burn-cancel");
const burnGo = $("burn-go");
const behind = () => [...document.body.children].filter((el) => el !== burnConfirm && el.tagName !== "SCRIPT");
function askBurn(open) {
  burnConfirm.hidden = !open;
  for (const el of behind()) el.inert = open; // the page behind the modal cannot be reached
  if (open) burnCancel.focus();
  else burnNow.focus();
}
burnNow.onclick = () => askBurn(true);
burnCancel.onclick = () => askBurn(false);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !burnConfirm.hidden && !burnGo.disabled) { e.preventDefault(); askBurn(false); }
});
// (An "Also delete Enki chats" choice would be read here and sent with the message; not in 0.8.4.)
burnGo.onclick = async () => {
  burnGo.disabled = burnCancel.disabled = true;
  burnGo.textContent = t("burning", "Burning…");
  await chrome.runtime.sendMessage({ type: "shields:burn" }); // closes every tab, this one too
};

// Enki Browser: its version, and "Check for updates" (updates.js).
const updateState = $("update-state");
const checkUpdates = $("check-updates");
const restartUpdate = $("restart-update");
const downloadUpdate = $("download-update");
downloadUpdate.href = DOWNLOAD;
function showUpdates(s, checked) {
  $("version").textContent = s.running ? `Enki Browser ${s.running}` : "Enki Browser";
  restartUpdate.hidden = true;
  $("restart-help").hidden = true;
  downloadUpdate.hidden = true;
  if (s.updater && s.ready) {
    updateState.textContent = t("upReady", `Enki Browser ${s.ready} is downloaded and verified. Restart to use it; every window and tab comes back.`, s.ready);
    restartUpdate.hidden = false;
  } else if (s.error) {
    updateState.textContent = t("upError", `Could not check for updates: ${s.error}`, s.error);
  } else if (s.updater && s.updatesOff) {
    updateState.textContent = t("upOff", "Updates are turned off on this computer (a file named no-update next to EnkiBrowser.exe).");
  } else if (!s.updater && s.latest && s.running && compare(s.latest, s.running) > 0) {
    updateState.textContent = t("upAvailable", `Enki Browser ${s.latest} is available. Install it the way you installed this one; your profile is kept.`, s.latest);
    downloadUpdate.hidden = false;
  } else if (checked) {
    // Say that a check just happened: "You have the latest version" alone looked like nothing ran.
    const latest = s.updater ? s.running : s.latest;
    updateState.textContent = !s.updater && !s.latest ? t("upNoLatest", "Checked just now · could not find the latest release.")
      : latest ? t("upLatestIs", `Checked just now · ${latest} is the latest.`, latest) : t("upLatest", "Checked just now · you have the latest version.");
  } else {
    updateState.textContent = s.updater ? t("upAuto", "Updates download by themselves every couple of hours.") : t("upManual", "This copy does not update by itself; check here for a new release.");
  }
}
// Default browser (default-browser.js): only for an install Windows knows as a browser.
async function showDefault() {
  const s = await defaultStatus(native);
  $("default-row").hidden = !s?.registered;
  if (!s?.registered) return;
  $("default-state").textContent = s.isDefault ? t("isDefault", "Enki Browser is your default browser.") : t("notDefault", "Another browser opens links from other apps.");
  $("make-default").hidden = s.isDefault;
}
$("make-default").onclick = async () => {
  $("default-state").textContent = (await openDefaultApps(native))
    ? t("defaultSteps", "In Windows Settings, choose Enki Browser, then “Set default”.")
    : t("defaultFail", "Windows Settings could not be opened. Open Settings → Apps → Default apps and choose Enki Browser.");
};
window.addEventListener("focus", () => void showDefault());
void showDefault();
showUpdates(await status(), false);
document.documentElement.dataset.updates = "ready"; // tests wait for this before reading or clicking
checkUpdates.onclick = async () => {
  checkUpdates.disabled = true;
  updateState.textContent = t("checking", "Checking… a download can take a minute.");
  try { showUpdates(await check(), true); } finally { checkUpdates.disabled = false; }
};
// Settings › About in the Enki panel and the Shields popup open this page at #check-updates:
// the check starts at once, as if the button had been clicked.
if (location.hash === "#check-updates") {
  history.replaceState(null, "", location.pathname); // a reload does not check again
  checkUpdates.scrollIntoView({ block: "center" });
  checkUpdates.focus();
  checkUpdates.click();
}
restartUpdate.onclick = () => restartWithFallback({ button: restartUpdate, state: updateState, help: $("restart-help") });

// Re-open the first-run guide (welcome.html). Does not clear the once-only flag;
// finishing or skipping still sends nothing out.
// The label follows the guide's language (welcome.js); its Portuguese wording is in options.html.
if (!navigator.language?.startsWith("pt")) $("show-guide").textContent = navigator.language?.startsWith("es") ? "Ver la guía otra vez" : "Show the guide again";
$("show-guide").onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
};

// Protected video (widevine.js).
await showWidevine($, native, restart);
document.documentElement.dataset.widevine = "ready"; // tests wait for this before reading or clicking

// Store extensions installed with "Install in Enki" (webstore.js): the update switch, the list
// with Forget, and any update notice.
const cwsSettings = $("cws-settings");
const cwsNotices = $("cws-notices");
const renderStore = () => Promise.all([renderSettings(cwsSettings), renderNotices(cwsNotices)]);
await renderStore();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.keys(changes).some((k) => k.startsWith("shields:cws-") && k !== "shields:cws-updates")) void renderStore();
});
