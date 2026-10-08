/**
 * The hold page (Receive tabs, 0.9). Each tab of an accepted packet opens here first. It shows the
 * link's title and domain as plain text and loads the site only when the user clicks Abrir.
 *
 * Everything in the query string came from an agent: it is re-checked here (same URL rules as the
 * receiver), shown with textContent only, and never rendered as a link, so Chromium has nothing to
 * prefetch or preconnect to. Navigation is location.replace (the hold page leaves no history
 * entry) with no referrer: the page's referrer policy is no-referrer.
 */
import "./hold.css";
import logo from "../assets/logo.svg";
import { checkUrl, normalizeText } from "../lib/a2a/validate-bundle.js";
import { AGENT_COLORS, type AgentColor } from "../lib/a2a/policy.js";
import { isValidWebNavigationUrl } from "../lib/urls";

const q = new URLSearchParams(location.search);
const text = (id: string, value: string) => { document.getElementById(id)!.textContent = value; };
const clip = (s: string, n: number) => [...s].slice(0, n).join("");

const link = checkUrl(q.get("u") ?? "");
const ok = link.ok && isValidWebNavigationUrl(link.url);
const host = link.ok ? link.host : "";
const title = clip(normalizeText(q.get("t") ?? ""), 80) || host || "Link";
const group = clip(normalizeText(q.get("g") ?? ""), 60);
const sender = clip(normalizeText(q.get("s") ?? ""), 40);
const color = AGENT_COLORS[(q.get("c") ?? "") as AgentColor] ?? AGENT_COLORS.blue;

(document.getElementById("logo") as HTMLImageElement).src = logo;
// Shield Buddy as the tab icon too (bundled with the extension, same origin); the site's favicon is never requested.
(document.getElementById("tab-icon") as HTMLLinkElement).href = logo;
text("title", title);
text("domain", ok ? host : "link inválido");
text("group", group);
text("sender", sender);
document.getElementById("dot")!.style.background = color;
// Same chip as the side panel: the agent's tab-group colour on a ~14% tint of itself.
Object.assign(document.getElementById("chip")!.style, { background: `${color}24`, color });
document.title = `${title} — aguardando`;

const button = document.getElementById("open") as HTMLButtonElement;
if (ok && link.ok) {
  button.disabled = false;
  button.addEventListener("click", () => location.replace(link.url));
} else {
  text("hint", "Este link não passou nas regras do Enki e não pode ser aberto.");
}
