// Enki Shields' global settings, opened from the panel's "Global settings".
import { BADGE, LEVELS, blocker, forgetList, setForget, setSite, sites } from "./sites.js";

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
