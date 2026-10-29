// Store extensions in Shields' settings (Ink's mock 04) and the update notice in the Shields
// panel and settings (mock 05). The worker (webstore.js) keeps the record and does the work;
// these pages only ask it, so the switch, Forget, Update and Later behave the same everywhere.
import { t } from "./i18n.js";

const UPDATES = "shields:cws-updates";
const ask = (what, extra = {}) => chrome.runtime.sendMessage({ what: `enki-shield:${what}`, ...extra });
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const nameOf = (id, r) => r?.name || id;

/** The extensions with a newer version whose notice was not put off with "Later". */
export function pending(state) {
  return Object.entries(state?.latest ?? {})
    .filter(([id, v]) => state.installed?.[id] && state.later?.[id] !== v)
    .map(([id, to]) => ({ id, name: nameOf(id, state.installed[id]), from: state.installed[id].version ?? "?", to }));
}

/** Mock 05, one notice per update; empty when the switch is off or nothing is newer. */
export async function renderNotices(box, after = () => {}) {
  const state = await ask("cws-list");
  const list = state?.on ? pending(state) : [];
  box.replaceChildren(...list.map((u) => {
    const card = el("div", { className: "cws-notice", role: "alertdialog" });
    const title = el("div", { className: "cws-title", id: `cws-t-${u.id}`, textContent: t("update_title", "Update available", u.name) });
    const versions = el("div", { className: "cws-versions", textContent: t("update_versions", `${u.from} → ${u.to}`, u.from, u.to) });
    versions.setAttribute("aria-label", `${u.from} – ${u.to}`);
    const body = el("p", { className: "cws-body", id: `cws-d-${u.id}`, textContent: t("update_body", "") });
    card.setAttribute("aria-labelledby", title.id);
    card.setAttribute("aria-describedby", body.id);
    const later = el("button", { type: "button", className: "pill quiet", textContent: t("update_later", "Later") });
    const now = el("button", { type: "button", className: "pill primary", textContent: t("update_now", "Update") });
    later.onclick = async () => { await ask("cws-later", { id: u.id }); await renderNotices(box, after); after(); };
    now.onclick = async () => { await ask("cws-update", { id: u.id }); await renderNotices(box, after); after(); };
    card.append(title, versions, body, el("div", { className: "buttons" }, later, now));
    return card;
  }));
  box.hidden = !list.length;
  box.querySelector(".cws-notice .pill.primary")?.focus(); // mock 05: Update has the initial focus
  return list;
}

/** Mock 04: the switch (off by default) and the list of extensions installed with Enki. */
export async function renderSettings(box) {
  const state = (await ask("cws-list")) ?? { on: false, installed: {} };
  const sw = el("button", { type: "button", className: "switch", id: "cws-updates" }, el("span"));
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", String(state.on === true));
  sw.setAttribute("aria-labelledby", "cws-updates-title");
  sw.setAttribute("aria-describedby", "cws-updates-sub");
  sw.onclick = async () => {
    const on = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", String(on));
    await chrome.storage.local.set({ [UPDATES]: on }); // webstore.js adds or removes its alarm
  };
  const status = el("span", { className: "fixed", role: "status" });
  status.setAttribute("aria-live", "polite");
  const rows = Object.entries(state.installed ?? {}).sort(([, a], [, b]) => nameOf("", a).localeCompare(nameOf("", b)));
  const list = el("ul", { className: "sites", id: "cws-list" });
  if (!rows.length) list.append(el("li", { textContent: t("settings_list_empty", "None yet.") }));
  for (const [id, r] of rows) {
    const forget = el("button", { type: "button", className: "pill quiet", textContent: t("settings_forget", "Forget") });
    forget.style.flex = "0 0 auto";
    forget.setAttribute("aria-label", t("settings_forget_aria", "Forget", nameOf(id, r)));
    forget.onclick = async () => {
      await ask("cws-forget", { id });
      await renderSettings(box);
      box.querySelector("[role=status]").textContent = t("settings_forgotten", "", nameOf(id, r));
    };
    const row = el("li", {},
      el("span", {}, nameOf(id, r), el("br"), el("span", { className: "fixed", textContent: t("settings_list_row", "", r.version ?? "?") })),
      forget);
    row.dataset.id = id;
    list.append(row);
  }
  box.replaceChildren(
    el("div", { className: "row" },
      el("span", { className: "grow" }, el("span", { id: "cws-updates-title", textContent: t("settings_updates_title", "") }), el("br"), el("span", { className: "fixed", id: "cws-updates-sub", textContent: t("settings_updates_sub", "") })),
      sw),
    el("div", { className: "row" }, el("span", { className: "grow" }, el("span", { textContent: t("settings_list_title", "") }), el("br"), el("span", { className: "fixed", textContent: t("settings_list_help", "") }))),
    list,
    status,
  );
}
