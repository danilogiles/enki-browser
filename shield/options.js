// Enki Shields' global settings, opened from the panel's "Global settings".
import { AUTO_BURN, BADGE, LEVELS, applySites, blocker, forgetList, setForget, setSite, sites } from "./sites.js";
import { DOWNLOAD, check, compare, native, restart, restartWithFallback, status } from "./updates.js";
import { defaultStatus, openDefaultApps } from "./default-browser.js";
import { showWidevine } from "./widevine.js";

const $ = (id) => document.getElementById(id);

const level = $("level");
level.replaceChildren(...LEVELS.map((l) => Object.assign(document.createElement("option"), { value: l.level, textContent: `${l.label} — ${l.hint}` })));
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

async function renderSites() {
  const all = await sites();
  const forget = await forgetList();
  const hosts = [...new Set([...Object.keys(all), ...forget])].sort();
  const list = $("sites");
  if (!hosts.length) { list.replaceChildren(Object.assign(document.createElement("li"), { textContent: "None yet." })); return; }
  list.replaceChildren(...hosts.map((h) => {
    const s = all[h] ?? {};
    const what = [s.scripts === "block" && "scripts blocked", s.cookies === "block" && "all cookies blocked", forget.includes(h) && "forgotten on close"].filter(Boolean).join(", ");
    const li = document.createElement("li");
    const reset = Object.assign(document.createElement("button"), { className: "link", textContent: "Reset" });
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
  burnGo.textContent = "Burning…";
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
    updateState.textContent = `Enki Browser ${s.ready} is downloaded and verified. Restart to use it; every window and tab comes back.`;
    restartUpdate.hidden = false;
  } else if (s.error) {
    updateState.textContent = `Could not check for updates: ${s.error}`;
  } else if (s.updater && s.updatesOff) {
    updateState.textContent = "Updates are turned off on this computer (a file named no-update next to EnkiBrowser.exe).";
  } else if (!s.updater && s.latest && s.running && compare(s.latest, s.running) > 0) {
    updateState.textContent = `Enki Browser ${s.latest} is available. Install it the way you installed this one; your profile is kept.`;
    downloadUpdate.hidden = false;
  } else if (checked) {
    // Say that a check just happened: "You have the latest version" alone looked like nothing ran.
    const latest = s.updater ? s.running : s.latest;
    updateState.textContent = !s.updater && !s.latest ? "Checked just now · could not find the latest release."
      : latest ? `Checked just now · ${latest} is the latest.` : "Checked just now · you have the latest version.";
  } else {
    updateState.textContent = s.updater ? "Updates download by themselves every couple of hours." : "This copy does not update by itself; check here for a new release.";
  }
}
// Default browser (default-browser.js): only for an install Windows knows as a browser.
async function showDefault() {
  const s = await defaultStatus(native);
  $("default-row").hidden = !s?.registered;
  if (!s?.registered) return;
  $("default-state").textContent = s.isDefault ? "Enki Browser is your default browser." : "Another browser opens links from other apps.";
  $("make-default").hidden = s.isDefault;
}
$("make-default").onclick = async () => {
  $("default-state").textContent = (await openDefaultApps(native))
    ? "In Windows Settings, choose Enki Browser, then “Set default”."
    : "Windows Settings could not be opened. Open Settings → Apps → Default apps and choose Enki Browser.";
};
window.addEventListener("focus", () => void showDefault());
void showDefault();
showUpdates(await status(), false);
document.documentElement.dataset.updates = "ready"; // tests wait for this before reading or clicking
checkUpdates.onclick = async () => {
  checkUpdates.disabled = true;
  updateState.textContent = "Checking… a download can take a minute.";
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

// Search engine for the address bar (search.html). Enki owns the choice; Shield gates it on
// "Allow in Incognito", since the address bar cannot be switched back by code.
// States follow Ink's mocks (0.8.9-search/v2): (a) setup n of 2, (b) Enki AI on + tip, (c) disabled.
await (async () => {
  const { CHOSEN_AT, PAUSED, REMINDED, SETUP_DONE, enforceIncognito, getEngine, markChosen, reminderDue, setEngine } = await import("./search-engine.js");
  const seg = $("search-seg");
  const radios = [...seg.querySelectorAll("button")];
  const url = chrome.runtime.getURL("search.html") + "?q=%s";
  $("search-url").value = url;
  $("copy-search-url").onclick = async () => { await navigator.clipboard.writeText(url); $("copy-search-url").textContent = "Copied"; };
  $("open-incognito").onclick = () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  let openList = false;
  let wantEnki = false; // chosen on this page; Enki keeps the real intent
  let changedTimer = null;
  let wasActive = null;
  const changed = () => {
    $("search-changed").hidden = false;
    clearTimeout(changedTimer);
    changedTimer = setTimeout(() => { $("search-changed").hidden = true; }, 2000);
  };
  $("search-finish-link").onclick = () => { openList = !openList; void show(); };
  $("search-resume").onclick = () => void choose("enki").then(() => $("open-incognito").click());
  $("search-switch").onclick = async () => {
    const help = $("search-switch-help");
    help.hidden = !help.hidden;
    $("search-switch").setAttribute("aria-expanded", String(!help.hidden));
    $("search-switch").textContent = `Switch back to DuckDuckGo ${help.hidden ? "▾" : "▴"}`;
  };
  $("reminder-show").onclick = () => { openList = true; $("search-reminder").hidden = true; void show(); };
  $("reminder-ddg").onclick = async () => { $("search-reminder").hidden = true; await choose("ddg"); };

  async function choose(engine) {
    // Enki owns the intent and the choice: it turns Enki AI on once both steps are done.
    if (engine === "enki") { openList = wantEnki = true; await setEngine("enki").catch(() => {}); await markChosen(); }
    else {
      openList = wantEnki = false;
      const before = await getEngine();
      await setEngine("ddg").catch(() => {});
      await chrome.storage.local.remove([PAUSED, CHOSEN_AT]);
      if (before === "enki") changed();
    }
    await show();
  }
  for (const r of radios) r.onclick = () => { if (!seg.classList.contains("dis")) void choose(r.dataset.engine); };

  async function show() {
    await enforceIncognito().catch(() => {});
    const engine = await getEngine();
    const incognito = await chrome.extension.isAllowedIncognitoAccess();
    const local = await chrome.storage.local.get([PAUSED, SETUP_DONE]);
    const setupDone = local[SETUP_DONE] === true;
    const done = Number(incognito) + Number(setupDone);
    const active = engine === "enki" && done === 2;
    if (wasActive === false && active) changed();
    wasActive = active;
    const off = engine === null;
    seg.classList.toggle("dis", off);
    for (const r of radios) { r.disabled = off; r.setAttribute("aria-checked", String(r.dataset.engine === (active ? "enki" : "ddg"))); }
    $("search-state").hidden = !off;
    $("search-state").textContent = "Turn on Enki to use AI search";
    const inSetup = !off && done < 2 && (wantEnki || engine === "enki" || local[PAUSED] === true);
    $("search-finish").hidden = !inSetup;
    $("search-finish-link").textContent = `Finish setup (${done} of 2 done) ${openList ? "▾" : "›"}`;
    $("search-finish-link").setAttribute("aria-expanded", String(openList));
    $("search-checklist").hidden = !(inSetup && openList);
    $("check-incognito").classList.toggle("done", incognito);
    $("check-default").classList.toggle("done", setupDone);
    $("search-tip").hidden = !active;
    $("search-paused").hidden = !(local[PAUSED] === true && engine === "ddg");
    if (inSetup && await reminderDue()) {
      $("search-reminder").hidden = false; // shown once
      await chrome.storage.local.set({ [REMINDED]: true });
    }
    document.documentElement.dataset.search = "ready";
  }
  window.addEventListener("focus", () => void show());
  await show();
})();
