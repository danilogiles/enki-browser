// The Shields panel: the button right of the address bar, as Brave's lion is.
import { BADGE, LEVELS, blocker, blockerId, forgetList, setForget, setSite, sites } from "./sites.js";

const $ = (id) => document.getElementById(id);
const DOCS = "https://github.com/danilogiles/enki-browser/blob/main/";

// ?tab=<id> lets tests open the panel as a page for a given tab.
const asked = Number(new URLSearchParams(location.search).get("tab"));
const tab = asked ? await chrome.tabs.get(asked) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

let host = "";
try {
  const url = new URL(tab?.url ?? "");
  if (/^https?:$/.test(url.protocol)) host = url.hostname;
} catch { /* not a web page */ }

const open = (url) => chrome.tabs.create({ url, index: (tab?.index ?? 0) + 1 });
$("terms").onclick = (e) => { e.preventDefault(); void open(DOCS + "TERMS.md"); };
$("privacy").onclick = (e) => { e.preventDefault(); void open(DOCS + "PRIVACY.md"); };
$("updates").onclick = (e) => { e.preventDefault(); void chrome.runtime.openOptionsPage(); };

if (!host) {
  $("app").hidden = true;
  $("not-web").hidden = false;
} else {
  await render();
}

async function render() {
  $("host").textContent = host;
  $("favicon").src = tab.favIconUrl || "icons/shield32.png";

  // Ads and trackers: uBlock's filtering mode for this site (0 = off).
  const level = await blocker("getFilteringMode", { hostname: host });
  const known = typeof level === "number";
  const up = !known || level > 0;
  setSwitch($("toggle"), up);
  $("state").textContent = up ? "Shields up for this site" : "Shields down for this site";
  $("advanced-body").classList.toggle("disabled", !up);

  const select = $("level");
  select.replaceChildren(...LEVELS.map((l) => Object.assign(document.createElement("option"), { value: l.level, textContent: l.label, title: l.hint })));
  select.value = String(up && known ? level : 2);
  select.disabled = !known;

  // What was blocked on this tab since the page loaded.
  const record = ((await chrome.storage.session.get("shields:tabs"))["shields:tabs"] ?? {})[tab.id];
  const count = record?.host === host ? record.count : 0;
  $("count").textContent = String(count);
  $("count-label").textContent = count === 1 ? "tracker, ad, or more blocked" : "trackers, ads, and more blocked";
  const list = $("blocked");
  list.replaceChildren(...Object.entries(record?.hosts ?? {}).sort((a, b) => b[1] - a[1]).map(([h, n]) => {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("span"), { textContent: h }), Object.assign(document.createElement("span"), { textContent: String(n) }));
    return li;
  }));
  $("count-box").onclick = () => {
    list.hidden = !list.hidden || !list.children.length;
    $("count-box").setAttribute("aria-expanded", String(!list.hidden));
  };

  const site = (await sites())[host] ?? {};
  setSwitch($("scripts"), site.scripts === "block");
  $("cookies").value = site.cookies ?? "";
  setSwitch($("forget"), (await forgetList()).includes(host));
}

function setSwitch(el, on) { el.setAttribute("aria-checked", String(on)); }
const isOn = (el) => el.getAttribute("aria-checked") === "true";
// Brave reloads the page when Shields change; so does this, so the change shows at once.
const reload = () => chrome.tabs.reload(tab.id);

$("toggle").onclick = async () => {
  const down = isOn($("toggle"));
  const level = down ? 0 : (await blocker("getDefaultFilteringMode")) ?? 2;
  await blocker("setFilteringMode", { hostname: host, level });
  await render();
  await reload();
};
$("level").onchange = async (e) => {
  await blocker("setFilteringMode", { hostname: host, level: Number(e.target.value) });
  await reload();
};
$("scripts").onclick = async () => {
  await setSite(host, { scripts: isOn($("scripts")) ? undefined : "block" });
  await render();
  await reload();
};
$("cookies").onchange = async (e) => {
  await setSite(host, { cookies: e.target.value || undefined });
  await reload();
};
$("forget").onclick = async () => {
  await setForget(host, !isOn($("forget")));
  await render();
};
$("advanced-toggle").onclick = () => {
  const body = $("advanced-body");
  body.hidden = !body.hidden;
  $("advanced-toggle").setAttribute("aria-expanded", String(!body.hidden));
};
$("lists").onclick = async () => {
  const id = await blockerId();
  if (id) void open(`chrome-extension://${id}/dashboard.html#rulesets`);
};
$("global").onclick = () => chrome.runtime.openOptionsPage();

// Burn (everything) and shred (this site) both ask first: they cannot be undone.
let pending = null;
const confirmBox = (kind) => {
  pending = kind;
  $("burn-text").textContent = kind === "burn"
    ? "Close every tab and delete all history, cookies, site data, cache, download history and autofill? Passwords, bookmarks and Enki's settings are kept."
    : `Delete ${host}'s cookies and site data and close its tabs?`;
  $("burn-go").textContent = kind === "burn" ? "Burn" : "Shred";
  $("burn-confirm").hidden = false;
};
$("burn").onclick = () => confirmBox("burn");
$("shred").onclick = () => confirmBox("shred");
$("burn-cancel").onclick = () => { pending = null; $("burn-confirm").hidden = true; };
$("burn-go").onclick = async () => {
  $("burn-go").disabled = true;
  $("burn-text").textContent = pending === "burn" ? "Burning…" : "Shredding…";
  await chrome.runtime.sendMessage(pending === "burn" ? { type: "shields:burn" } : { type: "shields:shred", host });
  window.close();
};
void BADGE;
// Everything above is wired up: tests wait for this before clicking (the site name appears first).
document.documentElement.dataset.ready = "true";
