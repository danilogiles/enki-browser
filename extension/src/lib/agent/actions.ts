/**
 * What an Act step is about to do, in structured form, and whether the user must confirm it.
 *
 * The executor describes the step (the tool, the element under it, the value, where it leads);
 * classifyAction() turns that into categories with a target origin and a value summary for the
 * confirmation card; mayAutoApprove() is the one place that decides what "Auto-approve sensitive
 * actions" may skip. Hard blocks (password and payment fields) are not decided here: the executor
 * refuses those before a plan exists, and nothing in this file can turn them back on.
 *
 * Pure functions, no chrome APIs, so test/safety-unit.cjs can cover every category.
 */
import { SENSITIVE_ACTION } from "../protocol";
import { READ_URL_STRINGS } from "../tools/read-url-strings";

export type ActionCategory =
  | "form_submit"
  | "sensitive_input"
  | "cross_origin_navigation"
  | "download"
  | "send_message"
  | "delete"
  | "account_settings"
  | "file_upload"
  | "connector_write"
  | "purchase"
  | "sensitive_click"
  | "page_requested"
  /** AIC-2: read_url to this computer or the local network, a host the user did not name. */
  | "local_network_read"
  /** AIC-2: read_url to an address the model built after reading web content. */
  | "untrusted_url_read";

/** Facts about the element a step acts on, gathered by the content script. */
export type ElementFacts = {
  role?: string;
  tag?: string;
  name?: string;
  inputType?: string;
  autocomplete?: string;
  isEmail?: boolean;
  /** In a form with a password field, a one-time code, PIN or security answer. */
  passwordAdjacent?: boolean;
  /** A textarea, rich editor or field named like a message, reply, comment or post body. */
  isMessageBody?: boolean;
  isFile?: boolean;
  isSubmit?: boolean;
  inForm?: boolean;
  formHasMessageBody?: boolean;
  /** Resolved address of a link, or the form's action. */
  href?: string;
  formAction?: string;
  download?: boolean;
  sensitive?: boolean;
  isPassword?: boolean;
  /** Raw id / name attributes (payment matching never relies on the accessible name alone). */
  id?: string;
  nameAttr?: string;
  contentEditable?: boolean;
  /** In a GET form whose only text-like control is this one (a search form). */
  formGetSingleText?: boolean;
  /** For a submit / Search button: the form's only text-like control, if it has exactly one. */
  formSearchField?: ElementFacts | null;
};

/** Kind of field Act filled — drives the form_submit auto-approve rule. */
export type FilledFieldType =
  | "email"
  | "message_body"
  | "account"
  | "payment"
  | "password"
  | "plain";

export type FilledField = {
  name: string;
  /** Display value; password-like fields are already masked. */
  value: string;
  origin: string;
  /** Canonical type used by mayAutoApprove (email / message_body / account block auto-approve). */
  fieldType: FilledFieldType;
  isEmail?: boolean;
  isMessageBody?: boolean;
  isAccountSettings?: boolean;
  isPassword?: boolean;
};

/** Derive fieldType from the flags the executor already records. */
export function fieldTypeOf(f: Omit<FilledField, "fieldType"> & { fieldType?: FilledFieldType }): FilledFieldType {
  if (f.fieldType) return f.fieldType;
  if (f.isPassword) return "password";
  if (f.isEmail) return "email";
  if (f.isMessageBody) return "message_body";
  if (f.isAccountSettings) return "account";
  return "plain";
}

export type ActionFacts = {
  tool: string;
  currentUrl?: string;
  target?: ElementFacts | null;
  value?: string;
  /** type with submit: Enter is pressed after typing. */
  submit?: boolean;
  key?: string;
  /** press_key / type: asking the page what holds focus failed or was rejected. */
  focusLookupFailed?: boolean;
  destinationUrl?: string;
  connector?: { app: string; tool: string; readOnly: boolean; allowed?: boolean };
  incognito?: boolean;
  label: string;
  /**
   * read_url only (AIC-2): which card read-url-policy.ts asked for. The executor computes it
   * (it knows the conversation's untrusted content); unset means the read needs no card.
   */
  readUrl?: { gate: "local" | "untrusted"; reach: "device" | "network" | "public"; url: string };
};

export type TurnContext = {
  /** The user's own words for this request (no tab header). */
  userRequest: string;
  /** Text of every untrusted fence the model has seen this turn. */
  pageData: string[];
  /** Act started right after an Ask answer in this conversation. */
  startedFromAsk: boolean;
  /** Fields Act filled during this task, for the submit summary. */
  filled: FilledField[];
};

export type Classification = {
  categories: ActionCategory[];
  /** The main category, the one the card's verb names. */
  primary: ActionCategory | null;
  /** What the element is called on the page ("Delete 3 emails"), if anything. */
  target: string;
  origin: string;
  value: string;
  /** Always-visible Why line for AIC-2 read_url cards (see ConfirmPayload.subtitle). */
  subtitle?: string;
  pageRequested: boolean;
  requiresConfirm: boolean;
  /** For connector writes the user allowed by name in Connections. */
  connectorAllowed?: boolean;
  /** A send whose site or recipient is not the one the user named. */
  unnamedRecipient?: boolean;
  incognito: boolean;
  /** Form submit (or navigate) stays on the tab's current origin. */
  sameOrigin: boolean;
  /** A submit whose destination could not be read: shown as unknown, treated as cross-site. */
  destinationUnknown?: boolean;
  /** The shared search-box rule let this submit (click, Enter, or type+submit) through. */
  searchSubmitAllowed?: boolean;
  /** A filled field was email, message/post body, or account/settings. */
  formHasSensitiveFilled: boolean;
  /** Structured rows for the confirm card (form submit). */
  filled?: FilledField[];
};

// ---------- origins ----------

export function originOf(url: string | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : `${u.protocol}`;
  } catch {
    return "";
  }
}

/**
 * Hostname used for same-site checks. No public-suffix list: only an exact hostname match,
 * or a match after stripping a leading "www.", counts as same-site. So github.com and
 * evil.github.io are cross-site; www.github.com and github.com are same-site.
 */
export function siteOf(url: string | undefined): string {
  if (!url) return "";
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return ""; }
  if (host.startsWith("www.")) host = host.slice(4);
  return host;
}

/**
 * Same ORIGIN for the search exception: scheme and port must match exactly; only the host may
 * differ by a leading "www.". So https://shop.test and https://www.shop.test match, while
 * http://shop.test, https://shop.test:8443 and http://example.com:8080 never match an https page.
 */
export function sameOriginWww(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  let ua: URL, ub: URL;
  try { ua = new URL(a); ub = new URL(b); } catch { return false; }
  if (ua.protocol !== "https:" && ua.protocol !== "http:") return false;
  if (ua.protocol !== ub.protocol) return false;
  if (ua.port !== ub.port) return false;
  const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, "");
  return host(ua) === host(ub);
}

/** True when both URLs share a hostname under the www-strip rule above. */
export function sameSite(a: string | undefined, b: string | undefined): boolean {
  const sa = siteOf(a);
  const sb = siteOf(b);
  return !!sa && !!sb && sa === sb;
}

const HOSTLIKE = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?\b/gi;

/** Sites the user named in their request: full addresses, bare domains, or a site's own name. */
export function namedByUser(url: string | undefined, userRequest: string): boolean {
  if (!url) return false;
  const site = siteOf(url);
  if (!site) return false;
  const text = userRequest.toLowerCase();
  for (const m of text.matchAll(HOSTLIKE)) {
    const named = siteOf(`https://${m[1]}`);
    if (named && named === site) return true;
  }
  // "go to github" names github.com — but only a bare brand.tld (two labels after "www."),
  // so it never names github.evil.io or github.com.evil.io.
  const labels = site.split(".");
  if (labels.length !== 2) return false;
  const brand = labels[0];
  return brand.length >= 3 && new RegExp(`(^|[^a-z0-9])${brand.replace(/[^a-z0-9-]/g, "")}([^a-z0-9]|$)`).test(text);
}


/** Hard-block payment fields: card number, expiry, CVC/CVV/CSC, cardholder, autocomplete cc-*, raw name/id, PT/ES. */
const PAYMENT_WORDS = new RegExp(
  "(?:^|[^a-z0-9])(?:" + [
    "credit[\\s_-]*card", "card[\\s_-]*(?:number|num|no)", "cardnumber", "cc[\\s_-]*(?:num|number|no|csc|cvc|cvv|exp\\w*|name)",
    "cvc2?", "cvv2?", "csc", "security[\\s_-]*code", "card[\\s_-]*(?:code|verification)",
    "expir(?:y|ation|es)?(?:[\\s_-]*(?:date|month|year))?", "exp[\\s_-]*(?:date|month|year|mm|yy)", "exp[\\s_-]*mm", 
    "card[\\s_-]*holder", "cardholder", "name[\\s_-]*on[\\s_-]*card", "iban", "routing",
    "n[uú]mero[\\s_-]*d[oe][\\s_-]*cart[aã]o", "c[oó]digo[\\s_-]*de[\\s_-]*seguran[cç]a", "validade", "titular",
    "n[uú]mero[\\s_-]*de[\\s_-]*tarjeta", "vencimiento", "caducidad", "c[oó]digo[\\s_-]*de[\\s_-]*seguridad",
  ].join("|") + ")(?:$|[^a-z0-9])",
  "i",
);

export function isPaymentField(el: { name?: string; nameAttr?: string; autocomplete?: string; inputType?: string; id?: string } | null | undefined): boolean {
  if (!el) return false;
  const auto = (el.autocomplete ?? "").toLowerCase();
  // autocomplete is a token list ("billing cc-number"), so match any token.
  if (/(^|\s)(cc-|credit|card)/.test(auto)) return true;
  const blob = `${el.name ?? ""} ${el.nameAttr ?? ""} ${el.id ?? ""}`.toLowerCase();
  return PAYMENT_WORDS.test(blob);
}

// ---------- press_key gate (fail closed) ----------

const TEXT_LIKE_TYPES = new Set(["", "text", "search", "tel", "url", "number"]);
const KEY_STATE_ROLES = new Set(["switch", "checkbox", "radio", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "tab"]);
const NON_TEXT_KEYS = new Set(["enter", "return", "tab", "escape", "esc", "backspace", "delete",
  "arrowup", "arrowdown", "arrowleft", "arrowright", "up", "down", "left", "right",
  "home", "end", "pageup", "pagedown", "f5"]);

/** Keys that insert text (letters, digits, punctuation, Space), with or without Shift. */
export function isTextKey(key: string): boolean {
  const k = (key ?? "").trim() || (key === " " ? " " : "");
  if (!k) return false;
  const parts = k.split("+");
  const base = (parts.pop() || (k.endsWith("+") ? "+" : "")).toLowerCase();
  if (parts.some((m) => /^(ctrl|control|alt|meta|cmd|command|option)$/i.test(m))) return false;
  if (NON_TEXT_KEYS.has(base)) return false;
  return base === "space" || base === " " || [...base].length === 1;
}

export function isFrameElement(t: { tag?: string } | null | undefined): boolean {
  const tag = (t?.tag ?? "").toLowerCase();
  return tag === "iframe" || tag === "frame";
}

/**
 * Hard blocks for text going into the focused element: password, payment, or a frame whose
 * inner element Enki cannot inspect. Returns the reason, or null.
 */
export function textHardBlock(t: (ElementFacts & { isPassword?: boolean }) | null | undefined): "password" | "payment" | "frame" | null {
  if (!t) return null;
  if (isFrameElement(t)) return "frame";
  if (t.isPassword) return "password";
  if (isPaymentField(t)) return "payment";
  return null;
}

/** A plain, non-sensitive single-line text input. Anything else (or unknown) is not plain. */
export function isPlainTextField(t: ElementFacts | null | undefined, lookupFailed = false): boolean {
  if (!t || lookupFailed) return false;
  const tag = (t.tag ?? "").toLowerCase();
  const role = (t.role ?? "").toLowerCase();
  if (tag !== "input") return false;
  const type = (t.inputType ?? "text").toLowerCase();
  if (!TEXT_LIKE_TYPES.has(type)) return false;
  if (t.isEmail || t.isPassword || t.passwordAdjacent || isPaymentField(t)) return false;
  if (t.isMessageBody || t.contentEditable || t.isSubmit || t.isFile) return false;
  if (role === "button" || role === "link" || KEY_STATE_ROLES.has(role)) return false;
  return true;
}

/** Search box: type=search, role=searchbox, or the single text field of a GET form. */
export function isSearchBox(t: ElementFacts | null | undefined, lookupFailed = false): boolean {
  if (!isPlainTextField(t, lookupFailed)) return false;
  return (t!.inputType ?? "").toLowerCase() === "search" || (t!.role ?? "").toLowerCase() === "searchbox" || !!t!.formGetSingleText;
}

/**
 * The search form's real destination is known and on this page's ORIGIN (same scheme and port,
 * same host or the host with a leading "www." stripped). The destination is the default submitter's formaction or the form's action
 * attribute, resolved against baseURI by the content script (the B5 resolver). No form at all
 * (a JS role=searchbox) or an unreadable action is unknown, and unknown is never this site.
 */
export function searchDestinationSameSite(t: ElementFacts | null | undefined, currentUrl: string | undefined): boolean {
  if (!t?.inForm || !t.formAction) return false;
  return sameOriginWww(t.formAction, currentUrl);
}

/**
 * Enter in a search box skips the submit card only when the form really goes to this site and
 * the page did not ask for the action (Cloak, 0.8.11). A GET form can still carry what was typed
 * to another site, or trigger an action through its URL.
 */
export function searchEnterSkipsConfirm(
  targetIsSearchBox: boolean,
  t: ElementFacts | null | undefined,
  currentUrl: string | undefined,
  pageRequested: boolean,
): boolean {
  if (!targetIsSearchBox) return false;
  if (!searchDestinationSameSite(t, currentUrl)) return false; // limit 1: same-site destination
  if (pageRequested) return false; // limit 2: never for page-requested actions
  return true;
}

/**
 * One rule for Act clicking a search form's submit / Search button and Act pressing Enter (or
 * type with submit) in its box (Helm, 0.8.11). The search box is the target itself for Enter,
 * and the form's only text field for a click on the submitter. The destination is the target's
 * formAction either way: the clicked submitter's formaction, or the default submitter's for Enter.
 */
export function searchSubmitSkipsConfirm(action: ActionFacts, viaSubmitter: boolean, pageRequested: boolean): boolean {
  const t = action.target;
  if (!t) return false;
  const box = viaSubmitter ? t.formSearchField : t;
  const lookupFailed = !viaSubmitter && !!action.focusLookupFailed;
  return searchEnterSkipsConfirm(isSearchBox(box, lookupFailed), t, action.currentUrl, pageRequested);
}

// ---------- vocabulary (English, Portuguese, Spanish) ----------

const SEND = /\b(send|post|publish|reply|respond|comment|tweet|share|submit (?:post|comment|reply)|enviar|publicar|postar|responder|comentar|compartilhar|compartir)\b/i;
const DELETE = /\b(delete|remove|trash|discard|erase|destroy|wipe|unsubscribe|deactivate|close (?:my )?account|excluir|apagar|remover|deletar|lixeira|descartar|eliminar|borrar|papelera|desativar|desactivar)\b/i;
const PURCHASE = /\b(buy|purchase|pay(?:ment)?|check ?out|place order|order now|subscribe|donate|comprar|pagar|finalizar compra|realizar pedido|assinar|suscribir(?:se)?|donar)\b/i;
const DOWNLOAD = /\b(download|baixar|descargar|export(?:ar)?)\b/i;
const UPLOAD = /\b(upload|attach(?: file)?|choose file|browse files|anexar|enviar arquivo|carregar arquivo|subir archivo|adjuntar|seleccionar archivo)\b/i;
const SETTINGS_PATH = /\/(settings|preferences|prefs|account|accounts|profile|security|privacy|billing|password|passwords|configura[cç][aã]o|configuracoes|configuraciones|conta|cuenta|ajustes|perfil|admin)(?=[\/?#]|$)/i;
const SETTINGS_NAME = /\b(save changes|update (?:profile|account|settings|email|password)|change (?:password|email|username)|two-factor|2fa|privacy settings|salvar altera[cç][oõ]es|alterar senha|guardar cambios|cambiar contrase[nñ]a)\b/i;
const DOWNLOAD_EXT = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|exe|msi|dmg|pkg|deb|rpm|apk|appimage|iso|img|bin|jar|bat|cmd|ps1|sh|csv|xlsx?|docx?|pptx?|torrent)(?:[?#]|$)/i;
const STATE_ROLES = new Set(["button", "switch", "checkbox", "radio", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "combobox", "slider", "tab"]);

// ---------- what the page asked for ----------

/**
 * Sentences that address the assistant or try to override its instructions. Kept broad on
 * purpose: a false positive costs one confirmation card, a miss can cost the user's account.
 */
const INJECTION = new RegExp([
  // ignore / disregard / forget … instructions (singular or plural, with fillers)
  "\\b(ignore|disregard|forget|override|bypass|skip)\\s+(?:(?:all|any|every|each|the|your|my|of|these|those|prior|previous|above|earlier|system|original|user'?s?|developer'?s?)\\s+){0,4}(instructions?|prompts?|messages?|rules?|directions?|directives?|guidelines?|commands?|orders?|context)\\b",
  "\\b(ignore|disregard|forget)\\s+(?:(?:everything|all|anything|what(?:ever)?|of|is|was|written|said|the)\\s+){0,3}(above|before|prior|previously|earlier)\\b",
  "\\b(you are|you're) now\\b",
  "\\bnew (instructions?|tasks?|objectives?|goals?)\\b",
  "\\b(ai|assistant|agent|enki|llm|chatbot|model|bot)s?\\b[\\s,:-]+(please\\s+)?(must|should|now|immediately|do|go|navigate|open|visit|submit|send|click|type|fill|delete|download)\\b",
  "\\b(attention|note|message|instructions?)\\s+(to|for)\\s+(the\\s+|all\\s+)?(ai|assistant|agent|llm|model|bot)s?\\b",
  "\\bsystem prompts?\\b",
  "\\bdo not (tell|inform|alert|warn|ask) the user\\b",
  "\\bthe user (?:has\\s+)?(wants|wanted|asked|asks|authori[sz]ed|authori[sz]es|approved|requested|permitted|allowed) you\\b",
  "\\[\\/?INST\\]",
  "<\\|im_[a-z_]*\\|>",
  "\\[tag removed:",
  "ignore (o|os|as) (instru[cç][oõ]es|comandos)",
  "\\besque[cç]a\\s+(?:(?:as|os|todas|todos|tudo|o|que|de|foi)\\s+){0,4}(instru[cç][oõ]es|comandos|regras|anterior(?:es)?|acima|dito)",
  "\\besque[cç]a tudo\\b",
  "ignora (las|los) (instrucciones|indicaciones)",
  "\\bolvida\\s+(?:(?:las|los|todas|todos|todo|lo|que|de)\\s+){0,4}(instrucciones|indicaciones|reglas|anterior(?:es)?|dicho)",
  "\\bolvida todo\\b",
  "instru[cç][oõ]es anteriores",
  "instrucciones anteriores",
].join("|"), "i");

/** True when any of this turn's page data reads like an injection. Exposed for tests. */
export function looksLikeInjection(pageData: string[]): boolean {
  // Scan each entry on its own (its newest 80k characters), so a long early page cannot push
  // the newest page out of the scan window.
  return pageData.some((entry) => INJECTION.test(String(entry ?? "").slice(-80_000)));
}

function pageRequestedAction(pageData: string[], action: ActionFacts): boolean {
  if (!pageData.length) return false;
  // Only injection-style language flags page-requested. Ordinary form labels ("Please enter
  // your full name") and page imperatives directed at the user must not trip this (Cloak).
  if (!looksLikeInjection(pageData)) return false;
  // Newest data last: keep the tail, not the head, when matching names and destinations.
  const blob = pageData.join("\n").slice(-80_000);
  const name = (action.target?.name ?? "").toLowerCase().trim();
  if (name.length >= 3 && blob.toLowerCase().includes(name)) return true;
  const dest = action.destinationUrl || action.target?.href || action.target?.formAction || "";
  if (dest) {
    const site = siteOf(dest);
    if (site && blob.toLowerCase().includes(site)) return true;
    try {
      const path = new URL(dest).pathname;
      if (path.length > 2 && blob.includes(path)) return true;
    } catch { /* ignore */ }
  }
  if (action.tool === "type" && action.value) {
    const v = action.value.toLowerCase().slice(0, 40);
    if (v.length >= 4 && blob.toLowerCase().includes(v)) return true;
  }
  // A page that speaks to the assistant and then this step runs a confirmable action: treat it as
  // page-requested even when the quote did not name the exact control.
  return action.tool === "click" || action.tool === "navigate" || action.tool === "new_tab"
    || !!action.submit || !!action.connector || action.tool === "press_key";
}

// ---------- value / verb ----------

const PASSWORD_NAME = /\b(password|passwd|passphrase|senha|contrase[nñ]a|pwd)\b/i;

/** Never show a password value on the confirm card, even if typing somehow reached fill tracking. */
export function maskFilledValue(field: FilledField): string {
  if (field.isPassword || PASSWORD_NAME.test(field.name)) return "••••••";
  return field.value;
}

function summarizeValue(action: ActionFacts, turn: TurnContext, cats: ActionCategory[]): string {
  if (action.readUrl && (cats.includes("local_network_read") || cats.includes("untrusted_url_read"))) {
    // Why goes on ConfirmPayload.subtitle (always visible). Address alone is the value box.
    return `${READ_URL_STRINGS.rowAddress}: ${action.readUrl.url}`;
  }
  if (cats.includes("form_submit")) {
    // Field list for the card / transcript — never repeat the verb, never show passwords.
    return turn.filled
      .map((f) => `${f.name || "field"}: ${maskFilledValue(f)}`)
      .join("\n");
  }
  if (action.value) {
    const v = action.value.length > 240 ? action.value.slice(0, 240) + "…" : action.value;
    return action.target?.name ? `${action.target.name}: ${v}` : v;
  }
  if (action.destinationUrl) return action.destinationUrl;
  if (action.target?.href) return action.target.href;
  if (action.connector) return `${action.connector.app} · ${action.connector.tool}`;
  return action.target?.name ?? "";
}

export function verbFor(primary: ActionCategory | null, target: string, cats: ActionCategory[]): string {
  const t = target.trim();
  switch (primary) {
    case "form_submit": return t || "Submit form";
    case "send_message": return t || "Send message";
    case "delete": return t || "Delete";
    case "purchase": return t || "Purchase";
    case "download": return t ? `Download ${t}` : "Download";
    case "file_upload": return t || "Upload file";
    case "account_settings": return t || "Change account settings";
    case "cross_origin_navigation": return t ? `Go to ${t}` : "Navigate to a new site";
    case "connector_write": return t || "Write to connected app";
    case "sensitive_input": return t ? `Type into ${t}` : "Type into a sensitive field";
    case "page_requested": return t || "Run page-requested action";
    case "sensitive_click": return t || "Sensitive action";
    case "local_network_read": return t || READ_URL_STRINGS.localNetworkVerb;
    case "untrusted_url_read": return t || READ_URL_STRINGS.untrustedVerb("this address");
    default:
      if (cats.length) return t || "Sensitive action";
      return t || "Action";
  }
}

const PRIORITY: ActionCategory[] = [
  "page_requested", "purchase", "send_message", "delete", "account_settings",
  "file_upload", "download", "form_submit", "sensitive_input",
  "cross_origin_navigation", "connector_write", "local_network_read", "untrusted_url_read",
  "sensitive_click",
];

function pickPrimary(cats: ActionCategory[]): ActionCategory | null {
  for (const c of PRIORITY) if (cats.includes(c)) return c;
  return cats[0] ?? null;
}

function push(cats: ActionCategory[], c: ActionCategory): void {
  if (!cats.includes(c)) cats.push(c);
}

// ---------- classifier ----------

/** The card's verb for a read_url gate (also the target, so page_requested keeps it). */
function readUrlVerb(r: NonNullable<ActionFacts["readUrl"]>): string {
  const S = READ_URL_STRINGS;
  if (r.gate === "local") return r.reach === "device" ? S.localDeviceVerb : S.localNetworkVerb;
  let host = "";
  try { host = new URL(r.url).host; } catch { /* below */ }
  return S.untrustedVerb(host || "this address");
}

export function classifyAction(action: ActionFacts, turn: TurnContext): Classification {
  const cats: ActionCategory[] = [];
  const t = action.target;
  const name = t?.name ?? "";
  const dest = action.destinationUrl || t?.href || t?.formAction || "";
  const currentOrigin = originOf(action.currentUrl);
  const destOrigin = originOf(dest);
  const incognito = !!action.incognito;
  const pageRequested = pageRequestedAction(turn.pageData, action);

  if (action.tool === "navigate" || action.tool === "new_tab") {
    if (dest && DOWNLOAD_EXT.test(dest)) push(cats, "download");
    if (dest && SETTINGS_PATH.test(dest)) push(cats, "account_settings");
    if (destOrigin && currentOrigin && destOrigin !== currentOrigin) {
      // New site the user did not name, or any new site when Act started from an Ask summary.
      if (turn.startedFromAsk || !namedByUser(dest, turn.userRequest)) {
        push(cats, "cross_origin_navigation");
      }
    }
  }

  // Click, or a key that activates like a click (Enter±modifiers / Space on button, role=button, link).
  const keyRaw = (action.key ?? "").trim();
  const keyBase = keyRaw.split("+").pop()?.toLowerCase() ?? "";
  const isActivateKey = action.tool === "press_key" && (
    /^(enter|return)$/i.test(keyBase)
    || (keyBase === "space" || keyBase === " " || keyRaw === " ")
  );
  const role = (t?.role ?? "").toLowerCase();
  const tag = (t?.tag ?? "").toLowerCase();
  const isButtonish = !!t && (
    role === "button" || role === "link" || tag === "button" || tag === "a"
    || t.isSubmit
  );
  // Enter / Space on a button or link carries the click categories (so the card names "Delete").
  const treatAsClick = action.tool === "click" || (isActivateKey && isButtonish);
  let searchClickSkips = false;
  let searchAllowed = false;

  if (treatAsClick && t) {
    if (t.isFile || UPLOAD.test(name)) push(cats, "file_upload");
    if (t.download || DOWNLOAD.test(name) || (t.href && DOWNLOAD_EXT.test(t.href))) push(cats, "download");
    if (PURCHASE.test(name)) push(cats, "purchase");
    if (DELETE.test(name)) push(cats, "delete");
    if (SEND.test(name) || (t.isSubmit && t.formHasMessageBody) || (t.formHasMessageBody && isButtonish)) {
      push(cats, "send_message");
    }
    if (SETTINGS_NAME.test(name) || (t.href && SETTINGS_PATH.test(t.href)) || (action.currentUrl && SETTINGS_PATH.test(action.currentUrl) && STATE_ROLES.has(t.role ?? ""))) {
      push(cats, "account_settings");
    }
    // Native submits, sensitive-named controls in a form, and JS role=button (incl. div) when
    // the control is in a form or Act has already filled fields this task.
    const jsSubmitButton = isButtonish && (t.inForm || turn.filled.length > 0);
    if (t.isSubmit || (t.inForm && SENSITIVE_ACTION.test(name)) || jsSubmitButton) {
      // Same rule as Enter in the search box: only a same-site search the page did not ask for skips.
      // It only ever drops the card for a bare submit: a button that is also a delete, purchase,
      // send, upload, … or has a sensitive name (Transfer, Confirm) never skips.
      searchClickSkips = cats.length === 0 && !SENSITIVE_ACTION.test(name)
        && searchSubmitSkipsConfirm(action, true, pageRequested);
      if (!searchClickSkips) push(cats, "form_submit");
      searchAllowed = searchClickSkips;
    }
    // A search click the shared rule let through already has a same-site destination (www rule).
    if (!searchClickSkips && destOrigin && currentOrigin && destOrigin !== currentOrigin && !namedByUser(dest, turn.userRequest)) {
      push(cats, "cross_origin_navigation");
    }
    if (t.sensitive && !cats.length && !searchClickSkips) push(cats, "sensitive_click");
  }

  // press_key fails closed: only a plain text field takes keys without asking. Enter in a plain
  // field, or in ANY field inside a form (email, textarea, …), is a submit: form_submit always, so
  // the card shows the field list and destination, with send_message on top for a message body.
  // The one exception is a same-origin search box the page did not ask for. Tab / Escape only
  // move focus or dismiss.
  if (action.tool === "press_key") {
    const lookupFailed = !!action.focusLookupFailed;
    const plain = isPlainTextField(t, lookupFailed);
    const focusOnly = /^(tab|escape|esc)$/.test(keyBase);
    if (!plain && !focusOnly) push(cats, "sensitive_input");
    const isEnter = /^(enter|return)$/.test(keyBase);
    const searchSkips = isEnter && searchSubmitSkipsConfirm(action, false, pageRequested);
    if (isEnter && (plain || !!t?.inForm) && !searchSkips) push(cats, "form_submit");
    if (isEnter && !searchSkips && (t?.formHasMessageBody || t?.isMessageBody)) push(cats, "send_message");
    if (searchSkips) searchAllowed = true;
  }

  if (action.tool === "type" && t) {
    if (t.isFile) push(cats, "file_upload");
    if (t.contentEditable) push(cats, "sensitive_input");
    if (t.isEmail || t.passwordAdjacent || t.isMessageBody) push(cats, "sensitive_input");
    if (action.submit) {
      // type with submit presses Enter: the same rule as press_key Enter. form_submit always
      // (unless the search-box rule allows it), send_message on top, never instead.
      const typeSearchSkips = searchSubmitSkipsConfirm(action, false, pageRequested);
      if (!typeSearchSkips) push(cats, "form_submit");
      if (t.isMessageBody || t.formHasMessageBody || SEND.test(name)) push(cats, "send_message");
      if (typeSearchSkips) searchAllowed = true;
    }
  }

  // type into whatever holds focus when that is unknown: ask (fail closed).
  if (action.tool === "type" && (!t || action.focusLookupFailed)) push(cats, "sensitive_input");

  if (action.connector && !action.connector.readOnly) push(cats, "connector_write");

  // read_url (AIC-2): the gate comes from read-url-policy.ts via the executor.
  if (action.tool === "read_url" && action.readUrl) {
    push(cats, action.readUrl.gate === "local" ? "local_network_read" : "untrusted_url_read");
  }

  if (pageRequested && cats.length) push(cats, "page_requested");
  // A page that ordered an action Enki would otherwise take without confirming still needs one.
  if (pageRequested && !cats.length && (action.tool === "click" || action.tool === "navigate" || action.tool === "new_tab" || action.tool === "type" || action.tool === "press_key" || !!action.connector)) {
    push(cats, "page_requested");
  }

  const primary = pickPrimary(cats);
  const unnamedRecipient = cats.includes("send_message") && !!dest
    && !namedByUser(dest, turn.userRequest) && siteOf(dest) !== siteOf(action.currentUrl);
  // Sends on the current site (Gmail compose) also count when the user never named that site.
  const sendUnnamed = cats.includes("send_message")
    && !namedByUser(action.currentUrl, turn.userRequest)
    && !namedByUser(dest, turn.userRequest);

  // A submit's destination is never assumed to be this site: unknown is shown as unknown.
  const destinationUnknown = cats.includes("form_submit") && !destOrigin;
  const origin = destinationUnknown
    ? ""
    : destOrigin || currentOrigin || (action.connector ? action.connector.app : "");
  const readTarget = action.tool === "read_url" && action.readUrl ? readUrlVerb(action.readUrl) : "";
  const target = readTarget || name || (action.connector ? `${action.connector.app}: ${action.connector.tool}` : "") || (dest ? siteOf(dest) : "");
  const value = summarizeValue(action, turn, cats);
  const subtitle = action.readUrl && (cats.includes("local_network_read") || cats.includes("untrusted_url_read"))
    ? (action.readUrl.gate === "local" ? READ_URL_STRINGS.localWhy : READ_URL_STRINGS.untrustedWhy)
    : undefined;
  const sameOrigin = destinationUnknown
    ? false
    : !destOrigin || !currentOrigin || destOrigin === currentOrigin;
  const formHasSensitiveFilled = turn.filled.some((f) => {
    const ft = fieldTypeOf(f);
    return ft === "email" || ft === "message_body" || ft === "account" || ft === "password" || ft === "payment";
  });
  // Submit cards always carry the field list, possibly empty ("Enki didn't fill in any fields.").
  const filled = cats.includes("form_submit")
    ? turn.filled.map((f) => ({ ...f, value: maskFilledValue(f) }))
    : undefined;

  return {
    categories: cats,
    primary,
    target,
    origin,
    value,
    subtitle,
    pageRequested: cats.includes("page_requested"),
    requiresConfirm: cats.length > 0,
    connectorAllowed: !!action.connector?.allowed,
    unnamedRecipient: unnamedRecipient || sendUnnamed,
    incognito,
    sameOrigin,
    destinationUnknown,
    searchSubmitAllowed: searchAllowed && cats.length === 0,
    formHasSensitiveFilled,
    filled,
  };
}

/**
 * What "Auto-approve sensitive actions" may skip. Everything else still shows the card.
 * Hard blocks never reach this function. Cloak owns this policy; keep the list in one place.
 */
export function mayAutoApprove(c: Classification): boolean {
  if (!c.requiresConfirm) return true;
  if (c.incognito) return false;
  if (c.pageRequested) return false;
  if (c.categories.includes("cross_origin_navigation")) return false;
  // AIC-2: a local read or a model-built address after web content always asks (Cloak).
  if (c.categories.includes("local_network_read")) return false;
  if (c.categories.includes("untrusted_url_read")) return false;
  if (c.categories.includes("download")) return false;
  if (c.categories.includes("file_upload")) return false;
  if (c.categories.includes("account_settings")) return false;
  if (c.categories.includes("sensitive_input")) return false;
  if (c.categories.includes("connector_write") && !c.connectorAllowed) return false;
  if (c.categories.includes("send_message") && c.unnamedRecipient) return false;
  // 0.8.11 fails closed: a form submit always asks, whatever the origin or filled fields.
  if (c.categories.includes("form_submit")) return false;
  // 0.8.11 fails closed: a send always asks too, even a JS Send button with no form on a site
  // the user named (Helm).
  if (c.categories.includes("send_message")) return false;
  // Allowed to skip: buy / delete style clicks and connector writes the user allowed by name.
  return c.categories.some((x) =>
    x === "purchase" || x === "delete" || x === "sensitive_click"
    || x === "connector_write");
}

export type ConfirmDecision = "allow" | "ask" | "skip";

/** Combines the classification with the user's autoApprove toggle. */
export function confirmDecision(c: Classification, autoApprove: boolean, alwaysAsk?: boolean): ConfirmDecision {
  if (!c.requiresConfirm && !alwaysAsk) return "skip";
  if (alwaysAsk) return "ask";
  if (autoApprove && mayAutoApprove(c)) return "allow";
  return "ask";
}
