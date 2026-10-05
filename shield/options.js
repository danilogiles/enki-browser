// Enki Shields' global settings, opened from the panel's "Global settings".
import { AUTO_BURN, BADGE, LEVELS, applySites, blocker, forgetList, setForget, setSite, sites } from "./sites.js";

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
$("burn-now").onclick = async () => {
  if (!confirm("Close every tab and delete all history, cookies, site data, cache, download history and autofill? Passwords, bookmarks and Enki's settings are kept.")) return;
  await chrome.runtime.sendMessage({ type: "shields:burn" });
};
