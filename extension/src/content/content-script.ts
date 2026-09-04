/**
 * Enki content script. Builds a compact accessibility-style snapshot of the page with stable
 * element references (ref_N) and performs DOM-level actions on request from the side panel.
 * It never talks to any LLM itself.
 */
import type {
  ContentRequest,
  ContentResponse,
  LocatedElement,
  PageInfo,
  ScrollDirection,
} from "../lib/protocol";
import { SENSITIVE_ACTION } from "../lib/protocol";

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "META",
  "LINK",
  "HEAD",
  "SVG",
  "PATH",
  "CANVAS",
  "VIDEO",
  "AUDIO",
  "SOURCE",
  "TRACK",
  "BR",
  "WBR",
]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "switch",
  "slider",
  "spinbutton",
  "treeitem",
]);

const TEXT_TAGS = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
  "LI",
  "TD",
  "TH",
  "LABEL",
  "DT",
  "DD",
  "BLOCKQUOTE",
  "FIGCAPTION",
  "LEGEND",
  "SUMMARY",
  "PRE",
  "CODE",
]);

let refs = new Map<string, Element>();
let refCounter = 0;

function refFor(el: Element): string {
  for (const [k, v] of refs) if (v === el) return k;
  const key = `ref_${++refCounter}`;
  refs.set(key, el);
  return key;
}

function isVisible(el: Element): boolean {
  const htmlEl = el as HTMLElement;
  if (typeof htmlEl.checkVisibility === "function") {
    if (!htmlEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  return true;
}

function roleOf(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit.toLowerCase();
  const tag = el.tagName;
  switch (tag) {
    case "A":
      return el.hasAttribute("href") ? "link" : "generic";
    case "BUTTON":
      return "button";
    case "SELECT":
      return "combobox";
    case "TEXTAREA":
      return "textbox";
    case "OPTION":
      return "option";
    case "SUMMARY":
      return "button";
    case "IMG":
      return "img";
    case "INPUT": {
      const type = ((el as HTMLInputElement).type || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "hidden") return "hidden";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    default:
      if (/^H[1-6]$/.test(tag)) return "heading";
      if ((el as HTMLElement).isContentEditable) return "textbox";
      return "generic";
  }
}

function isInteractive(el: Element, role: string): boolean {
  if (INTERACTIVE_ROLES.has(role)) return true;
  if (el.hasAttribute("onclick")) return true;
  const tabindex = el.getAttribute("tabindex");
  if (tabindex !== null && Number(tabindex) >= 0 && el.tagName !== "DIV" && el.tagName !== "SPAN") {
    return true;
  }
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function clean(text: string | null | undefined, max = 90): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function nameOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return clean(aria);
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const txt = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (txt.trim()) return clean(txt);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    if (el.labels && el.labels.length) return clean(el.labels[0].textContent);
    if (el instanceof HTMLInputElement && ["button", "submit", "reset"].includes(el.type)) {
      return clean(el.value);
    }
    if (!(el instanceof HTMLSelectElement) && el.placeholder) return clean(el.placeholder);
    if (el.name) return clean(el.name);
  }
  const alt = el.getAttribute("alt");
  if (alt) return clean(alt);
  const title = el.getAttribute("title");
  if (title) return clean(title);
  const text = (el as HTMLElement).innerText ?? el.textContent;
  return clean(text);
}

function ownText(el: Element): string {
  let out = "";
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? "";
  return clean(out, 160);
}

function positionTag(el: Element): string {
  const r = el.getBoundingClientRect();
  if (r.bottom < 0) return " (above viewport)";
  if (r.top > window.innerHeight) return " (below viewport)";
  return "";
}

type Line = { text: string; interactive: boolean };

function describe(el: Element, role: string): string {
  const name = nameOf(el);
  let s = `${role}${name ? ` "${name}"` : ""}`;
  if (el instanceof HTMLAnchorElement && el.href) {
    const href = el.getAttribute("href") ?? "";
    if (href && !href.startsWith("javascript:")) s += ` href="${clean(href, 70)}"`;
  }
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") s += el.checked ? " checked" : " unchecked";
    else if (!["button", "submit", "reset", "password"].includes(el.type)) {
      s += ` value="${clean(el.value, 60)}"`;
      if (el.placeholder && nameOf(el) !== clean(el.placeholder)) {
        s += ` placeholder="${clean(el.placeholder, 40)}"`;
      }
      if (el.type !== "text") s += ` type=${el.type}`;
    } else if (el.type === "password") s += " type=password";
  } else if (el instanceof HTMLTextAreaElement) {
    s += ` value="${clean(el.value, 60)}"`;
  } else if (el instanceof HTMLSelectElement) {
    const sel = el.selectedOptions[0];
    s += ` selected="${clean(sel?.textContent, 50)}"`;
    const opts = Array.from(el.options)
      .slice(0, 12)
      .map((o) => clean(o.textContent, 30))
      .join(" | ");
    if (opts) s += ` options=[${opts}${el.options.length > 12 ? " | …" : ""}]`;
  }
  if (el.getAttribute("aria-expanded")) s += ` expanded=${el.getAttribute("aria-expanded")}`;
  if (el.getAttribute("aria-selected") === "true") s += " selected";
  if ((el as HTMLButtonElement).disabled) s += " disabled";
  return s;
}

function snapshot(filter: "interactive" | "all", maxChars: number): string {
  refs = new Map();
  refCounter = 0;
  const lines: Line[] = [];
  const seen = new Set<Element>();

  const walk = (root: Node, depth: number) => {
    const children = root instanceof ShadowRoot || root instanceof Document ? root.childNodes : root.childNodes;
    for (const node of children) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      if (SKIP_TAGS.has(el.tagName)) continue;
      if (el.id === "__enki_overlay") continue;
      if (!isVisible(el)) continue;
      if (seen.has(el)) continue;
      seen.add(el);

      const role = roleOf(el);
      if (role === "hidden") continue;
      const interactive = isInteractive(el, role);
      const indent = "  ".repeat(Math.min(depth, 6));

      if (interactive) {
        lines.push({
          text: `${indent}[${refFor(el)}] ${describe(el, role)}${positionTag(el)}`,
          interactive: true,
        });
      } else if (filter === "all") {
        if (role === "heading") {
          lines.push({ text: `${indent}${el.tagName.toLowerCase()} "${nameOf(el)}"`, interactive: false });
        } else if (role === "img") {
          const alt = el.getAttribute("alt");
          if (alt) lines.push({ text: `${indent}img "${clean(alt)}"`, interactive: false });
        } else if (TEXT_TAGS.has(el.tagName) || el.tagName === "DIV" || el.tagName === "SPAN") {
          const t = ownText(el);
          if (t.length > 1) lines.push({ text: `${indent}text "${t}"`, interactive: false });
        }
      }

      // Don't descend into controls; their children are their label.
      const leaf =
        interactive &&
        (el.tagName === "BUTTON" ||
          el.tagName === "SELECT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "INPUT" ||
          (el.tagName === "A" && (el as HTMLElement).innerText.length < 120));
      if (!leaf) {
        if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
        walk(el, depth + 1);
      }
    }
  };
  walk(document.body ?? document.documentElement, 0);

  const info = pageInfo();
  const header =
    `Page: ${info.title} — ${info.url}\n` +
    `Viewport ${info.viewport.width}x${info.viewport.height}, scrolled ${info.scroll.y}/${info.scroll.maxY}px. ` +
    `${lines.filter((l) => l.interactive).length} interactive elements.\n`;
  let out = header;
  let truncated = false;
  for (const l of lines) {
    if (out.length + l.text.length + 1 > maxChars) {
      truncated = true;
      break;
    }
    out += l.text + "\n";
  }
  if (truncated) out += `…(truncated at ${maxChars} chars; use find(query) to locate specific elements)\n`;
  return out;
}

function find(query: string): string {
  snapshot("all", 1_000_000); // rebuild refs for the whole page
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);
  const hits: string[] = [];
  for (const [ref, el] of refs) {
    const role = roleOf(el);
    const desc = describe(el, role);
    const hay = `${desc} ${el.id} ${el.className}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) {
      hits.push(`[${ref}] ${desc}${positionTag(el)}`);
      if (hits.length >= 20) break;
    }
  }
  if (!hits.length) {
    // Also try non-interactive text matches so the model knows the text exists.
    const text = (document.body?.innerText ?? "").toLowerCase();
    if (words.every((w) => text.includes(w))) {
      return `No interactive element matches "${query}", but the text appears on the page (it may be plain text).`;
    }
    return `No element matches "${query}".`;
  }
  return hits.join("\n");
}

function pageText(maxChars: number): string {
  const main = document.querySelector("main, article, [role=main]") as HTMLElement | null;
  const src = main && main.innerText.trim().length > 200 ? main : document.body;
  const text = (src?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim();
  const head = `Page: ${document.title} — ${location.href}\n\n`;
  return text.length > maxChars
    ? head + text.slice(0, maxChars) + `\n…(truncated, ${text.length} chars total)`
    : head + text;
}

function pageInfo(): PageInfo {
  const doc = document.documentElement;
  return {
    url: location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: {
      x: Math.round(window.scrollX),
      y: Math.round(window.scrollY),
      maxY: Math.max(0, Math.round(doc.scrollHeight - window.innerHeight)),
    },
    dpr: window.devicePixelRatio || 1,
  };
}

function getRef(ref: string): Element {
  const el = refs.get(ref);
  if (!el || !el.isConnected) {
    throw new Error(`Element ${ref} is no longer on the page. Call read_page or find again to get fresh references.`);
  }
  return el;
}

function isPasswordField(el: Element): boolean {
  if (el instanceof HTMLInputElement) {
    if (el.type.toLowerCase() === "password") return true;
    const auto = (el.getAttribute("autocomplete") ?? "").toLowerCase();
    if (auto.includes("password") || auto.includes("cc-csc") || auto.includes("current-password") || auto.includes("new-password")) {
      return true;
    }
  }
  return false;
}

function locate(ref: string): LocatedElement {
  const el = getRef(ref);
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior });
  const r = el.getBoundingClientRect();
  const role = roleOf(el);
  const name = nameOf(el);
  const isSubmit =
    (el instanceof HTMLInputElement && el.type === "submit") ||
    (el instanceof HTMLButtonElement && (el.type === "submit" || !el.type) && !!el.form);
  return {
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
    tag: el.tagName.toLowerCase(),
    role,
    name,
    sensitive: SENSITIVE_ACTION.test(name) || (isSubmit && !/search|buscar|pesquisar/i.test(name)),
    isPassword: isPasswordField(el),
  };
}

function describePoint(x: number, y: number): LocatedElement {
  // Deepest element at the point, entering shadow roots.
  let el: Element | null = document.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  if (!el) return { x, y, tag: "?", role: "?", name: "", sensitive: false, isPassword: false };
  // Prefer the closest interactive ancestor for naming/sensitivity.
  let cur: Element | null = el;
  while (cur && !isInteractive(cur, roleOf(cur)) && cur !== document.body) cur = cur.parentElement;
  const target = cur && cur !== document.body ? cur : el;
  const role = roleOf(target);
  const name = nameOf(target);
  return {
    x,
    y,
    tag: target.tagName.toLowerCase(),
    role,
    name,
    sensitive: SENSITIVE_ACTION.test(name),
    isPassword: isPasswordField(target),
  };
}

function focusEl(ref: string, clear: boolean): void {
  const el = getRef(ref) as HTMLElement;
  el.focus({ preventScroll: false });
  if (!clear) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.select();
  } else if (el.isContentEditable) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}

function setValue(ref: string, text: string): void {
  const el = getRef(ref) as HTMLElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, text) : (el.value = text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (el.isContentEditable) {
    el.focus();
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, text);
  } else {
    throw new Error(`Element ${ref} is not editable.`);
  }
}

function domClick(ref: string): void {
  const el = getRef(ref) as HTMLElement;
  el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  el.click();
}

function scroll(direction: ScrollDirection, amount: number, ref?: string): PageInfo {
  const target: Element | Window = ref ? getRef(ref) : window;
  const page = amount * 0.8;
  const dx = direction === "left" ? -page * window.innerWidth : direction === "right" ? page * window.innerWidth : 0;
  const dy = direction === "up" ? -page * window.innerHeight : direction === "down" ? page * window.innerHeight : 0;
  if (target === window) window.scrollBy({ left: dx, top: dy, behavior: "instant" as ScrollBehavior });
  else (target as Element).scrollBy({ left: dx, top: dy, behavior: "instant" as ScrollBehavior });
  return pageInfo();
}

function flash(x: number, y: number): void {
  let overlay = document.getElementById("__enki_overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "__enki_overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    (document.body ?? document.documentElement).appendChild(overlay);
  }
  const ring = document.createElement("div");
  ring.style.cssText =
    `position:absolute;left:${x - 14}px;top:${y - 14}px;width:28px;height:28px;border-radius:50%;` +
    "border:3px solid #2dd4bf;box-shadow:0 0 0 4px rgba(45,212,191,.25);" +
    "animation:__enki_pulse .6s ease-out forwards;";
  if (!document.getElementById("__enki_style")) {
    const style = document.createElement("style");
    style.id = "__enki_style";
    style.textContent =
      "@keyframes __enki_pulse{0%{transform:scale(.6);opacity:1}100%{transform:scale(1.6);opacity:0}}";
    document.head.appendChild(style);
  }
  overlay.appendChild(ring);
  setTimeout(() => ring.remove(), 700);
}

function handle(req: ContentRequest): unknown {
  switch (req.type) {
    case "enki:ping":
      return "pong";
    case "enki:page_info":
      return pageInfo();
    case "enki:snapshot":
      return snapshot(req.filter, req.maxChars ?? (req.filter === "interactive" ? 9000 : 14000));
    case "enki:find":
      return find(req.query);
    case "enki:text":
      return pageText(req.maxChars ?? 20000);
    case "enki:locate":
      return locate(req.ref);
    case "enki:describe_point":
      return describePoint(req.x, req.y);
    case "enki:focus":
      focusEl(req.ref, req.clear);
      return true;
    case "enki:dom_click":
      domClick(req.ref);
      return true;
    case "enki:set_value":
      setValue(req.ref, req.text);
      return true;
    case "enki:scroll":
      return scroll(req.direction, req.amount, req.ref);
    case "enki:flash":
      flash(req.x, req.y);
      return true;
  }
}

chrome.runtime.onMessage.addListener(
  (req: ContentRequest, _sender, sendResponse: (r: ContentResponse) => void) => {
    if (!req || typeof req.type !== "string" || !req.type.startsWith("enki:")) return;
    try {
      sendResponse({ ok: true, data: handle(req) });
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  },
);
