/**
 * Executes browser tools from the side panel. Uses the content script for DOM reads and
 * element location, and the Chrome DevTools Protocol (chrome.debugger) for trusted mouse and
 * keyboard input, falling back to DOM-level actions when the debugger cannot attach.
 */
import type { ImagePart, TextPart, ToolCallPart } from "../types";
import type { ContentRequest, ContentResponse, LocatedElement, PageInfo } from "../protocol";
import { formatResults, readDuckDuckGoPage, textOfHtml, webSearch } from "./web";
import { findTool, runTool, type Connection } from "../connectors";
import {
  classifyAction,
  originOf,
  verbFor,
  type ActionCategory,
  type ActionFacts,
  type Classification,
  type ElementFacts,
  type FilledField,
  type TurnContext,
  fieldTypeOf,
  isPaymentField,
  isPlainTextField,
  isTextKey,
  textHardBlock,
} from "../agent/actions";
import { fence, newNonce, safeRole, type UntrustedSource } from "../agent/untrusted";
import { readUrlGate, readUrlReach, redirectAllowed, seenVerbatim, userNamedHost } from "./read-url-policy";
import { READ_URL_STRINGS } from "./read-url-strings";

export type ToolOutput = { content: Array<TextPart | ImagePart>; isError?: boolean };

/** What the approval card shows when a step needs an explicit Allow. */
export type ConfirmPayload = {
  category: ActionCategory;
  /** First line of the card: the action as a verb ("Submit form", "Delete 3 emails"). */
  verb: string;
  origin: string;
  value: string;
  /**
   * Always-visible reason under the verb (AIC-2 read_url cards). Not collapsed behind Show all.
   * When set, Chat renders this instead of the mono origin line.
   */
  subtitle?: string;
  pageRequested: boolean;
  /** Full category list for the policy / diagnostics. */
  categories: ActionCategory[];
  /** Form-submit rows for the value box (name → masked value); [] means "Enki didn't fill in any fields." */
  filled?: FilledField[];
  /** Submit destination could not be read: the card says so instead of naming this site. */
  destinationUnknown?: boolean;
};

/**
 * The tab a step would act on is in another browser window. Enki only ever acts in the window its
 * panel belongs to, so this is a stop, never a question: the panel shows it in the confirm card
 * with Cancel only, and nothing runs in the other window.
 */
export type OtherWindowStop = {
  tabId: number;
  /** The tab's title as the browser reports it: page-controlled text, shown as plain text only. */
  title: string;
};

export class TabInOtherWindowError extends Error {
  readonly stop: OtherWindowStop;
  constructor(stop: OtherWindowStop) {
    // The message reaches the model and the logs; it carries no page text.
    super("That tab is in another window. Enki only acts in the window it was opened in, so this task stopped.");
    this.name = "TabInOtherWindowError";
    this.stop = stop;
  }
}

export function isTabInOtherWindow(e: unknown): e is TabInOtherWindowError {
  return e instanceof TabInOtherWindowError || (!!e && typeof e === "object" && (e as { name?: string }).name === "TabInOtherWindowError" && !!(e as { stop?: unknown }).stop);
}

/** What the card needs from a tab, capped so a huge title cannot bloat the event or the card. */
function otherWindowStop(tab: chrome.tabs.Tab): OtherWindowStop {
  const title = (tab.title ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  return { tabId: tab.id ?? -1, title };
}

export type ToolPlan = {
  /** Human-readable description shown in the UI, e.g. `Click "Sign in"`. */
  label: string;
  /** True when the action deserves a confirmation card before running. */
  sensitive: boolean;
  /** Ask even with auto-approve on: a write to another service the user did not allow by name. */
  alwaysAsk?: boolean;
  /** Structured fields for the confirmation card (Ink styles this). */
  confirm?: ConfirmPayload;
  /** Classification used by mayAutoApprove; set whenever sensitive is true. */
  classification?: Classification;
  run: () => Promise<ToolOutput>;
};

/** Request-scoped safety state: the fence nonce, the user's words, and what Act has filled. */
export type TurnSafety = {
  nonce: string;
  userRequest: string;
  pageData: string[];
  startedFromAsk: boolean;
  filled: FilledField[];
  /** The tab Enki started this Act turn on (origin of "cross-origin from Ask"). */
  startUrl?: string;
  /**
   * AIC-2: text of untrusted tool results from earlier turns of this conversation (bounded).
   * pageData starts empty each turn, but those results are still in the model's context, so
   * read_url treats them as "web content was read" (read-url-policy.ts).
   */
  priorUntrusted?: string[];
};

const RESTRICTED_URL = /^(chrome|edge|brave|opera|vivaldi|arc|about|chrome-extension|devtools|view-source|file|javascript|data):/i;

export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  return RESTRICTED_URL.test(trimmed) || trimmed.startsWith("https://chromewebstore.google.com");
}

export function isValidWebNavigationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !isRestrictedUrl(url);
  } catch {
    return false;
  }
}


const HARD_BLOCK_TEXT = {
  password: "Security restriction: Enki is prevented from typing into password or credential fields for safety. Please enter credentials manually.",
  payment: "Security restriction: Enki is prevented from typing into payment fields for safety. Please enter payment details manually.",
  frame: "Security restriction: focus is inside an embedded frame Enki cannot inspect, so Enki will not type there. Click into the field you mean, or type it yourself.",
} as const;

/**
 * AIC-2: the cookieless background tab's session rule. One rule per tab id, in a range of its own
 * so it never collides with other session rules. Every resource type is listed: an omitted
 * resourceTypes would skip main_frame, the very request that matters.
 */
const COOKIELESS_RULE_BASE = 4_200_000;
export function cookielessRuleId(tabId: number): number {
  return COOKIELESS_RULE_BASE + (Math.abs(tabId) % 1_000_000);
}
export function cookielessRule(id: number, tabId: number): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority: 1,
    action: {
      type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
      requestHeaders: [{ header: "cookie", operation: "remove" as chrome.declarativeNetRequest.HeaderOperation }],
      responseHeaders: [{ header: "set-cookie", operation: "remove" as chrome.declarativeNetRequest.HeaderOperation }],
    },
    condition: {
      tabIds: [tabId],
      resourceTypes: [
        "main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object",
        "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport", "webbundle", "other",
      ] as chrome.declarativeNetRequest.ResourceType[],
    },
  };
}

const text = (t: string): TextPart => ({ type: "text", text: t });
const ok = (t: string): ToolOutput => ({ content: [text(t)] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const KEY_CODES: Record<string, { code: string; vk: number; text?: string }> = {
  enter: { code: "Enter", vk: 13, text: "\r" },
  tab: { code: "Tab", vk: 9 },
  escape: { code: "Escape", vk: 27 },
  esc: { code: "Escape", vk: 27 },
  backspace: { code: "Backspace", vk: 8 },
  delete: { code: "Delete", vk: 46 },
  space: { code: "Space", vk: 32, text: " " },
  arrowup: { code: "ArrowUp", vk: 38 },
  arrowdown: { code: "ArrowDown", vk: 40 },
  arrowleft: { code: "ArrowLeft", vk: 37 },
  arrowright: { code: "ArrowRight", vk: 39 },
  up: { code: "ArrowUp", vk: 38 },
  down: { code: "ArrowDown", vk: 40 },
  left: { code: "ArrowLeft", vk: 37 },
  right: { code: "ArrowRight", vk: 39 },
  home: { code: "Home", vk: 36 },
  end: { code: "End", vk: 35 },
  pageup: { code: "PageUp", vk: 33 },
  pagedown: { code: "PageDown", vk: 34 },
  f5: { code: "F5", vk: 116 },
};

export class BrowserExecutor {
  /** Connected apps whose tools this executor may run (see lib/connectors). */
  private connections: Connection[] = [];
  setConnections(list: Connection[]): void { this.connections = list; }
  beginTurn(safety: TurnSafety): void {
    this.turn = {
      ...safety, filled: [...safety.filled], pageData: [...safety.pageData],
      priorUntrusted: safety.priorUntrusted ? [...safety.priorUntrusted] : undefined,
    };
    this.keyRows.clear();
  }
  /** Rows in turn.filled built from press_key text, keyed by origin + field name. */
  private keyRows = new Map<string, FilledField>();
  endTurn(): void { this.turn = null; }
  /** Fence nonce for this user request, if a turn is active. */
  currentNonce(): string | undefined { return this.turn?.nonce; }
  turnContext(): TurnContext {
    const t = this.turn;
    return {
      userRequest: t?.userRequest ?? "",
      pageData: t?.pageData ?? [],
      startedFromAsk: !!t?.startedFromAsk,
      filled: t?.filled ?? [],
    };
  }
  private rememberPageData(text: string): void {
    if (!this.turn || !text) return;
    this.turn.pageData.push(text);
    // Keep a bounded window so a long task cannot grow this without limit.
    if (this.turn.pageData.length > 12) this.turn.pageData.splice(0, this.turn.pageData.length - 12);
  }
  private wrap(content: string, source: UntrustedSource, url?: string, maxChars?: number): string {
    const nonce = this.turn?.nonce ?? newNonce();
    return fence(content, { source, nonce, url, maxChars });
  }
  private factsFrom(el: LocatedElement | null | undefined): ElementFacts | null {
    if (!el) return null;
    return {
      role: el.role, tag: el.tag, name: el.name, inputType: el.inputType, autocomplete: el.autocomplete,
      isEmail: el.isEmail, passwordAdjacent: el.passwordAdjacent,
      isMessageBody: el.isMessageBody, isFile: el.isFile, isSubmit: el.isSubmit, inForm: el.inForm,
      formHasMessageBody: el.formHasMessageBody,
      href: el.href, formAction: el.formAction, download: el.download, sensitive: el.sensitive,
      isPassword: el.isPassword, id: el.id, nameAttr: el.nameAttr, contentEditable: el.contentEditable,
      formGetSingleText: el.formGetSingleText, formSearchField: el.formSearchField,
    };
  }
  private planFrom(action: ActionFacts, alwaysAsk = false): { label: string; sensitive: boolean; alwaysAsk?: boolean; confirm?: ConfirmPayload; classification?: Classification } {
    const c = classifyAction(action, this.turnContext());
    // Content-script sensitive flag is a backstop: never drop a confirm the DOM already flagged.
    // The DOM flags every submit; only the shared search-box rule (searchSubmitSkipsConfirm, the
    // same one Enter uses) may clear that flag. Every other submit already carries form_submit.
    if (!c.requiresConfirm && action.target?.sensitive && !c.searchSubmitAllowed) {
      c.categories.push("sensitive_click");
      c.primary = c.primary ?? "sensitive_click";
      c.requiresConfirm = true;
    }
    if (!c.requiresConfirm && !alwaysAsk) {
      return { label: action.label, sensitive: false };
    }
    const verb = verbFor(c.primary, c.target, c.categories);
    return {
      label: verb,
      sensitive: true,
      alwaysAsk: alwaysAsk || undefined,
      classification: c,
      confirm: {
        category: c.primary ?? "sensitive_click",
        verb,
        origin: c.origin,
        value: c.value,
        subtitle: c.subtitle,
        pageRequested: c.pageRequested,
        categories: c.categories,
        filled: c.filled,
        destinationUnknown: c.destinationUnknown,
      },
    };
  }
  private lockedTabId: number | null = null;
  /**
   * Set only when an agent tool deliberately retargets the task (switch_tab / open_tab).
   * The panel uses this to decide whether a tab choice should outlive the task: following
   * the user's active tab is the default, and only the agent's own switch is sticky.
   */
  private agentTabId: number | null = null;
  lockTab(tabId: number | null): void { this.lockedTabId = tabId; this.agentTabId = null; }
  /** The tab the agent itself selected during this task, or null if it never switched. */
  agentSelectedTab(): number | null { return this.agentTabId; }
  private retarget(tabId: number): void { this.lockedTabId = tabId; this.agentTabId = tabId; }
  private attached = new Set<number>();
  private screenshotScale = 1;
  /** Tabs currently showing the "Enki is controlling this tab" overlay. */
  private overlayTabs = new Set<number>();
  private overlayActive = false;
  private overlayLabel = "Enki is controlling this tab…";
  /** Set by the panel at the start of every turn; cleared on release. */
  private turn: TurnSafety | null = null;

  constructor(private readonly windowId: number) {
    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId) this.attached.delete(source.tabId);
    });
  }

  // ---------- tab helpers ----------

  async currentTab(): Promise<chrome.tabs.Tab> {
    if (this.lockedTabId !== null) {
      const tab = await chrome.tabs.get(this.lockedTabId).catch(() => null);
      if (!tab) throw new Error("The controlled tab was closed or moved. Choose a tab before continuing.");
      // Moved to another window (dragged out, or merged elsewhere): stop, never follow it there.
      if (tab.windowId !== this.windowId) throw new TabInOtherWindowError(otherWindowStop(tab));
      return tab;
    }
    const [tab] = await chrome.tabs.query({ active: true, windowId: this.windowId });
    if (!tab?.id) throw new Error("No active tab in this window.");
    return tab;
  }

  private async currentTabId(): Promise<number> {
    return (await this.currentTab()).id!;
  }

  /**
   * A page's text without touching the user's tab. A plain fetch is enough for most pages; a page
   * that builds itself with JavaScript (the TSE's live results, dashboards) says almost nothing in
   * its HTML, so it is opened in a background tab, read once it has rendered, and closed.
   *
   * AIC-2: neither path sends the user's cookies (fetch: credentials "omit"; tab: cookie headers
   * stripped, see inBackgroundTab), and a redirect may not land on a local host other than the
   * one that was approved (read-url-policy.ts redirectAllowed), on either path.
   */
  private async readUrl(url: string, max: number): Promise<string> {
    const cut = (t: string) => (t.length > max ? `${t.slice(0, max)}\n[…truncated at ${max} characters]` : t);
    const refuseRedirect = (finalUrl: string | undefined) => {
      if (finalUrl && !redirectAllowed(url, finalUrl)) {
        let host = finalUrl;
        try { host = new URL(finalUrl).host; } catch { /* keep the raw value */ }
        throw new Error(READ_URL_STRINGS.redirectedLocal(host));
      }
    };
    let res: Response | null = null;
    try {
      res = await fetch(url, { credentials: "omit" });
    } catch { /* blocked by CORS or the network: try rendering it */ }
    if (res) {
      refuseRedirect(res.url || url); // outside the catch: a refused redirect must not fall back to a tab
      try {
        const type = res.headers.get("content-type") ?? "";
        if (res.ok && /json|text\/plain|csv/.test(type)) return cut(`${url}\n\n${await res.text()}`);
        if (res.ok && /html/.test(type)) {
          const page = textOfHtml(await res.text());
          if (page.text.length > 800) return cut(`${page.title} — ${res.url}\n\n${page.text}`);
        }
      } catch { /* unreadable body: try rendering it */ }
    }
    return this.inBackgroundTab(url, async (tabId) => {
      const fresh = await chrome.tabs.get(tabId);
      refuseRedirect(fresh.url ?? fresh.pendingUrl);
      const body = await this.send<string>(tabId, { type: "enki:text", maxChars: max });
      return cut(`${fresh.title ?? ""} — ${fresh.url ?? url}\n\n${body}`);
    });
  }

  /**
   * Opens `url` in a tab the user does not switch to, lets it render, reads it and closes it.
   *
   * AIC-2: the tab lives in the user's profile, so it is opened on about:blank first, a session
   * declarativeNetRequest rule for that tab alone strips the Cookie request header and the
   * Set-Cookie response header, and only then does it navigate. No rule, no tab (fail closed).
   * Page script in that tab can still see first-party storage (document.cookie, localStorage);
   * what never leaves the browser is the cookie on the request.
   */
  private async inBackgroundTab<T>(url: string, read: (tabId: number) => Promise<T>): Promise<T> {
    const dnr = (chrome as unknown as { declarativeNetRequest?: typeof chrome.declarativeNetRequest }).declarativeNetRequest;
    if (!dnr?.updateSessionRules) throw new Error(READ_URL_STRINGS.noCookielessTab);
    const tab = await chrome.tabs.create({ url: "about:blank", windowId: this.windowId, active: false });
    const ruleId = cookielessRuleId(tab.id!);
    try {
      try {
        await dnr.updateSessionRules({ removeRuleIds: [ruleId], addRules: [cookielessRule(ruleId, tab.id!)] });
      } catch {
        throw new Error(READ_URL_STRINGS.noCookielessTab);
      }
      await chrome.tabs.update(tab.id!, { url });
      await this.waitForLoad(tab.id!, 20000);
      await sleep(2500); // let live content arrive after load
      return await read(tab.id!);
    } finally {
      await chrome.tabs.remove(tab.id!).catch(() => undefined);
      await dnr.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => undefined);
    }
  }

  /**
   * Refuses a tab showing a browser-internal page: chrome://, and every chrome-extension:// page,
   * such as Enki Shields' settings with its Burn all data button. Checked before anything reaches
   * the page, whether through the content script or through the debugger's trusted input; the
   * browser also refuses the debugger there, but Act must not depend on that.
   */
  private async refuseInternal(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId);
    if (isRestrictedUrl(tab.url)) {
      throw new Error(
        `This tab (${tab.url ?? "internal page"}) is a browser-internal page and cannot be read or controlled. Navigate to a website first.`,
      );
    }
  }

  private async send<T>(tabId: number, req: ContentRequest): Promise<T> {
    await this.refuseInternal(tabId);
    const attempt = async (): Promise<T> => {
      const res = (await chrome.tabs.sendMessage(tabId, req)) as ContentResponse<T> | undefined;
      if (!res) throw new Error("No response from page.");
      if (!res.ok) throw new Error(res.error);
      return res.data;
    };
    try {
      return await attempt();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/Receiving end does not exist|Could not establish connection|No response/.test(msg)) throw e;
      // Content script not present (tab opened before install, or page still loading). Inject it.
      const files = chrome.runtime.getManifest().content_scripts?.flatMap((cs) => cs.js ?? []) ?? [];
      await chrome.scripting.executeScript({ target: { tabId }, files });
      await sleep(150);
      return attempt();
    }
  }

  private async waitForLoad(tabId: number, timeoutMs = 20000): Promise<void> {
    const start = Date.now();
    await sleep(400);
    while (Date.now() - start < timeoutMs) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) return;
      if (tab.status === "complete" && Date.now() - start > 700) break;
      await sleep(250);
    }
    await sleep(400);
    // A load replaces the document, taking the overlay with it. Put it back.
    this.overlayTabs.delete(tabId);
    await this.applyOverlay();
  }

  // ---------- CDP helpers ----------

  private async attach(tabId: number): Promise<boolean> {
    await this.refuseInternal(tabId); // also when already attached: the tab may have navigated since
    if (this.attached.has(tabId)) return true;
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      this.attached.add(tabId);
      return true;
    } catch {
      return false;
    }
  }

  private cdp<T = unknown>(tabId: number, method: string, params?: Record<string, unknown>): Promise<T> {
    return chrome.debugger.sendCommand({ tabId }, method, params) as unknown as Promise<T>;
  }

  /**
   * Shows or hides the glowing Comet-style border and badge over the controlled page.
   * The overlay is remembered for the whole turn: it is re-applied after navigation (which
   * destroys it along with the old document) and after tab switches, and clearing it visits
   * every tab that ever received it so no window is left glowing.
   */
  async setActiveOverlay(active: boolean, label?: string): Promise<void> {
    if (active) {
      this.overlayLabel = label ?? this.overlayLabel;
      this.overlayActive = true;
      await this.applyOverlay();
      return;
    }
    this.overlayActive = false;
    for (const tabId of [...this.overlayTabs]) {
      await this.send(tabId, { type: "enki:set_active", active: false }).catch(() => undefined);
      this.overlayTabs.delete(tabId);
    }
  }

  /** (Re)draws the overlay on the current tab when a turn is active. Safe to call often. */
  private async applyOverlay(): Promise<void> {
    if (!this.overlayActive) return;
    try {
      const tab = await this.currentTab();
      if (tab?.id && !isRestrictedUrl(tab.url)) {
        await this.send(tab.id, { type: "enki:set_active", active: true, label: this.overlayLabel });
        this.overlayTabs.add(tab.id);
      }
    } catch {
      /* no active tab, or the page cannot host the overlay */
    }
  }

  /** Detach the debugger from every tab and remove the active visual overlay. */
  async release(): Promise<void> {
    this.endTurn();
    await this.setActiveOverlay(false).catch(() => undefined);
    for (const tabId of [...this.attached]) {
      await chrome.debugger.detach({ tabId }).catch(() => undefined);
      this.attached.delete(tabId);
    }
  }

  private async clickAt(tabId: number, x: number, y: number, fallbackRef?: string): Promise<void> {
    await this.refuseInternal(tabId);
    this.send(tabId, { type: "enki:flash", x, y }).catch(() => undefined);
    if (await this.attach(tabId)) {
      const base = { x, y, button: "left", clickCount: 1 };
      await this.cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await this.cdp(tabId, "Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
      await this.cdp(tabId, "Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
      return;
    }
    if (fallbackRef) {
      await this.send(tabId, { type: "enki:dom_click", ref: fallbackRef });
      return;
    }
    throw new Error("Cannot click by coordinates on this page (debugger unavailable). Use a ref instead.");
  }

  private async pressKey(tabId: number, combo: string): Promise<void> {
    await this.refuseInternal(tabId);
    if (!(await this.attach(tabId))) {
      throw new Error("Keyboard input is unavailable on this page (debugger could not attach).");
    }
    const parts = combo.split("+").map((p) => p.trim());
    const keyName = parts.pop() ?? "";
    let modifiers = 0;
    for (const m of parts.map((p) => p.toLowerCase())) {
      if (m === "alt") modifiers |= 1;
      else if (m === "ctrl" || m === "control") modifiers |= 2;
      else if (m === "meta" || m === "cmd" || m === "command") modifiers |= 4;
      else if (m === "shift") modifiers |= 8;
    }
    const special = KEY_CODES[keyName.toLowerCase()];
    let key: string;
    let code: string;
    let vk: number;
    let txt: string | undefined;
    if (special) {
      key = special.code === "Space" ? " " : special.code;
      code = special.code;
      vk = special.vk;
      txt = special.text;
    } else if (keyName.length === 1) {
      key = keyName;
      code = /[a-z]/i.test(keyName) ? `Key${keyName.toUpperCase()}` : /[0-9]/.test(keyName) ? `Digit${keyName}` : "";
      vk = keyName.toUpperCase().charCodeAt(0);
      txt = modifiers & 6 ? undefined : keyName;
    } else {
      throw new Error(`Unknown key "${keyName}".`);
    }
    const common = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
    await this.cdp(tabId, "Input.dispatchKeyEvent", {
      ...common,
      type: txt ? "keyDown" : "rawKeyDown",
      text: txt,
      unmodifiedText: txt,
    });
    await this.cdp(tabId, "Input.dispatchKeyEvent", { ...common, type: "keyUp" });
  }

  // ---------- screenshot ----------

  async screenshot(): Promise<ImagePart & { width: number; height: number }> {
    const tab = await this.currentTab();
    if (!tab.active) throw new Error("Select the controlled tab before taking a screenshot. Enki will not capture a different tab.");
    const info = isRestrictedUrl(tab.url)
      ? null
      : await this.send<PageInfo>(tab.id!, { type: "enki:page_info" }).catch(() => null);
    const dataUrl = await chrome.tabs.captureVisibleTab(this.windowId, { format: "jpeg", quality: 82 });
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());

    let width = info?.viewport.width ?? Math.round(bitmap.width / (info?.dpr ?? 1));
    let height = info?.viewport.height ?? Math.round(bitmap.height / (info?.dpr ?? 1));
    let scale = 1;
    const MAX_W = 1400;
    if (width > MAX_W) {
      scale = MAX_W / width;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    this.screenshotScale = scale;

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    }
    return { type: "image", mediaType: "image/jpeg", data: btoa(bin), width, height };
  }

  // ---------- planning ----------

  async prepare(call: ToolCallPart): Promise<ToolPlan> {
    const input = call.input ?? {};
    const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
    const num = (k: string) => (typeof input[k] === "number" ? (input[k] as number) : undefined);
    const bool = (k: string) => input[k] === true;

    switch (call.name) {
      case "read_page": {
        const filter = str("filter") === "all" ? "all" : "interactive";
        return {
          label: `Read page (${filter})`,
          sensitive: false,
          run: async () => {
            const tab = await this.currentTab();
            const raw = await this.send<string>(tab.id!, { type: "enki:snapshot", filter });
            this.rememberPageData(raw);
            return ok(this.wrap(raw, "read_page", tab.url));
          },
        };
      }
      case "find": {
        const query = str("query") ?? "";
        return {
          label: `Find "${query}"`,
          sensitive: false,
          run: async () => {
            const tab = await this.currentTab();
            const raw = await this.send<string>(tab.id!, { type: "enki:find", query });
            this.rememberPageData(raw);
            return ok(this.wrap(raw, "find", tab.url));
          },
        };
      }
      case "get_page_text":
        return {
          label: "Read page text",
          sensitive: false,
          run: async () => {
            const tab = await this.currentTab();
            const raw = await this.send<string>(tab.id!, { type: "enki:text", maxChars: num("max_chars") });
            this.rememberPageData(raw);
            return ok(this.wrap(raw, "get_page_text", tab.url));
          },
        };
      case "screenshot":
        return {
          label: "Take screenshot",
          sensitive: false,
          run: async () => {
            const tab = await this.currentTab();
            const shot = await this.screenshot();
            const { width, height, ...img } = shot;
            const caption = this.wrap(
              `Screenshot ${width}x${height} of "${tab.title ?? ""}" — ${tab.url ?? ""}. Coordinates map 1:1 to click(x, y).`,
              "screenshot",
              tab.url,
              2000,
            );
            return { content: [text(caption), img] };
          },
        };
      case "list_tabs":
        return {
          label: "List tabs",
          sensitive: false,
          run: async () => {
            const tabs = await chrome.tabs.query({ windowId: this.windowId });
            const raw = tabs
              .map((t) => `${t.active ? "* " : "  "}[${t.id}] ${t.title ?? ""} — ${t.url ?? ""}`)
              .join("\n");
            return ok(this.wrap(raw, "list_tabs"));
          },
        };
      case "web_search": {
        const query = (str("query") ?? "").trim();
        return {
          label: `Search the web: "${query}"`,
          sensitive: false,
          run: async () => {
            const raw = formatResults(query, await webSearch(query, (url) => this.inBackgroundTab(url, async (tabId) =>
              (await chrome.scripting.executeScript({ target: { tabId }, func: readDuckDuckGoPage }))[0]?.result ?? [])));
            this.rememberPageData(raw);
            return ok(this.wrap(raw, "web_search"));
          },
        };
      }
      case "read_url": {
        let url = (str("url") ?? "").trim();
        if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
        if (!isValidWebNavigationUrl(url)) throw new Error(`read_url only reads http/https web pages, not "${url}".`);
        const max = Math.max(500, Math.min(num("max_chars") ?? 15000, 60000));
        const host = new URL(url).host;
        const run = async (): Promise<ToolOutput> => {
          const raw = await this.readUrl(url, max);
          this.rememberPageData(raw);
          return ok(this.wrap(raw, "read_url", url));
        };
        // AIC-2: local hosts the user did not name, and addresses the model built after reading
        // web content, ask first (read-url-policy.ts). Everything else reads as before.
        const seenData = [...(this.turn?.pageData ?? []), ...(this.turn?.priorUntrusted ?? [])];
        const reach = readUrlReach(new URL(url).hostname);
        const gate = readUrlGate({
          reach,
          userNamed: userNamedHost(url, this.turn?.userRequest ?? ""),
          untrustedInContext: seenData.length > 0,
          seen: seenVerbatim(url, seenData),
        });
        if (gate === "none") return { label: `Read ${host}`, sensitive: false, run };
        const meta = this.planFrom({
          tool: "read_url",
          destinationUrl: url,
          label: `Read ${host}`,
          readUrl: { gate, reach, url },
        });
        return { ...meta, run };
      }
      case "navigate": {
        let url = (str("url") ?? "").trim();
        const isHistory = url === "back" || url === "forward";
        if (!isHistory) {
          if (!url) throw new Error("url is required.");
          if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
          if (!isValidWebNavigationUrl(url)) {
            throw new Error(`Security restriction: Cannot navigate to "${url}". Only standard http/https web URLs are allowed.`);
          }
        }
        const tab = await this.currentTab();
        const dest = isHistory ? undefined : url;
        const meta = this.planFrom({
          tool: "navigate",
          currentUrl: tab.url,
          destinationUrl: dest,
          incognito: !!tab.incognito,
          label: isHistory ? `Go ${url}` : `Go to ${url}`,
        });
        return {
          ...meta,
          run: async () => {
            const tabId = tab.id ?? (await this.currentTabId());
            if (url === "back") await chrome.tabs.goBack(tabId);
            else if (url === "forward") await chrome.tabs.goForward(tabId);
            else await chrome.tabs.update(tabId, { url });
            await this.waitForLoad(tabId);
            const fresh = await chrome.tabs.get(tabId);
            const where = this.wrap(`${fresh.title ?? ""} — ${fresh.url ?? ""}`, "navigate", fresh.url);
            return ok(`Now on ${where}. Call read_page to see its content.`);
          },
        };
      }
      case "click": {
        const ref = str("ref");
        const x = num("x");
        const y = num("y");
        const tab = await this.currentTab();
        const tabId = tab.id!;
        let target: LocatedElement | null = null;
        if (ref) target = await this.send<LocatedElement>(tabId, { type: "enki:locate", ref });
        else if (x !== undefined && y !== undefined) {
          const px = Math.round(x / this.screenshotScale);
          const py = Math.round(y / this.screenshotScale);
          target = await this.send<LocatedElement>(tabId, { type: "enki:describe_point", x: px, y: py }).catch(
            () => ({ x: px, y: py, tag: "?", role: "?", name: "", sensitive: false }),
          );
        } else throw new Error("click needs a ref or x,y.");
        const t = target!;
        const label = t.name ? `Click "${t.name}"` : `Click ${t.role} at (${t.x}, ${t.y})`;
        const meta = this.planFrom({
          tool: "click",
          currentUrl: tab.url,
          destinationUrl: t.href,
          target: this.factsFrom(t),
          incognito: !!tab.incognito,
          label,
        });
        return {
          ...meta,
          run: async () => {
            await this.clickAt(tabId, t.x, t.y, ref);
            await sleep(500);
            const fresh = await chrome.tabs.get(tabId);
            const nameBit = t.name ? this.wrap(t.name, "click", tab.url) : "";
            const where = this.wrap(`${fresh.title ?? ""} — ${fresh.url ?? ""}`, "click", fresh.url);
            return ok(`Clicked ${safeRole(t.role)}${nameBit ? ` "${nameBit}"` : ""}. Page is now ${where}. Call read_page or screenshot to see the result.`);
          },
        };
      }
      case "type": {
        const ref = str("ref");
        const value = str("text") ?? "";
        const append = bool("append");
        const submit = bool("submit");
        const tab = await this.currentTab();
        const tabId = tab.id!;
        let target: LocatedElement | null = null;
        if (ref) target = await this.send<LocatedElement>(tabId, { type: "enki:locate", ref });
        // Without a ref the text lands in whatever holds focus, so inspect that instead —
        // otherwise the password guard below would be trivially bypassed.
        let focusLookupFailed = false;
        if (!ref) {
          target = await this.send<LocatedElement | null>(tabId, { type: "enki:focused" })
            .catch(() => { focusLookupFailed = true; return null; });
        }
        // Hard blocks: password, payment, and a focused IFRAME / FRAME whose inner field is unknown.
        const block = textHardBlock(this.factsFrom(target));
        if (block) throw new Error(HARD_BLOCK_TEXT[block]);
        const preview = value.length > 40 ? value.slice(0, 40) + "…" : value;
        const label = `Type "${preview}"${target?.name ? ` into "${target.name}"` : ""}${submit ? " and press Enter" : ""}`;
        const meta = this.planFrom({
          tool: "type",
          currentUrl: tab.url,
          target: this.factsFrom(target),
          focusLookupFailed: focusLookupFailed || (!ref && !target),
          value,
          submit,
          destinationUrl: target?.formAction,
          incognito: !!tab.incognito,
          label,
        });
        return {
          ...meta,
          run: async () => {
            if (ref) await this.send(tabId, { type: "enki:focus", ref, clear: !append });
            if (await this.attach(tabId)) {
              if (!ref && !append) await this.pressKey(tabId, "ctrl+a");
              await this.cdp(tabId, "Input.insertText", { text: value });
            } else if (ref) {
              await this.send(tabId, { type: "enki:set_value", ref, text: value });
            } else {
              throw new Error("Cannot type without a ref on this page (debugger unavailable).");
            }
            // Every typed field is listed on a later submit card, search boxes included: a card for a
            // cross-site search must show the query it would send.
            if (this.turn && target) {
              const shown = value.length > 120 ? value.slice(0, 120) + "…" : value;
              const onSettings = /\/(settings|preferences|prefs|account|accounts|profile|security|privacy|billing|password|passwords|configura|conta|cuenta|ajustes|perfil|admin)(?=[\/?#]|$)/i.test(tab.url ?? "")
                || /\b(save changes|update (?:profile|account|settings|email|password)|change (?:password|email|username)|two-factor|2fa|privacy settings)\b/i.test(target.name ?? "");
              const row = {
                name: target.name || target.role || "field",
                value: target.isPassword ? "••••••" : shown,
                origin: originOf(tab.url),
                isEmail: !!target.isEmail,
                isMessageBody: !!target.isMessageBody,
                isAccountSettings: onSettings,
                isPassword: !!target.isPassword,
                fieldType: "plain" as const,
              };
              this.turn.filled.push({
                ...row,
                fieldType: isPaymentField(target) ? "payment" : fieldTypeOf(row),
              });
            }
            if (submit) {
              await sleep(120);
              await this.pressKey(tabId, "Enter");
              await this.waitForLoad(tabId, 8000);
            }
            const into = target?.name
              ? `"${this.wrap(target.name, "type", tab.url)}"`
              : "the focused element";
            return ok(`Typed into ${into}${submit ? " and pressed Enter" : ""}.`);
          },
        };
      }
      case "press_key": {
        const key = str("key") ?? "";
        const tab = await this.currentTab();
        const tabId = tab.id!;
        // Resolve the focused element on every key. A lookup that fails or rejects means "unknown",
        // and unknown is never plain: the step asks first (fail closed).
        let focusLookupFailed = false;
        const target = await this.send<LocatedElement | null>(tabId, { type: "enki:focused" })
          .catch(() => { focusLookupFailed = true; return null; });
        const textKey = isTextKey(key);
        if (textKey) {
          const block = textHardBlock(this.factsFrom(target));
          if (block) throw new Error(HARD_BLOCK_TEXT[block]);
        }
        const facts = this.factsFrom(target);
        const plain = isPlainTextField(facts, focusLookupFailed);
        const meta = this.planFrom({
          tool: "press_key",
          currentUrl: tab.url,
          target: facts,
          key,
          focusLookupFailed,
          destinationUrl: target?.href || target?.formAction,
          incognito: !!tab.incognito,
          label: target?.name ? `Press ${key} on "${target.name}"` : `Press ${key}`,
        });
        return {
          ...meta,
          run: async () => {
            await this.pressKey(tabId, key);
            await sleep(300);
            // Text keys typed into a plain field are listed on the submit card like `type` is.
            if (this.turn && target && plain && textKey) {
              const name = target.name || target.role || "field";
              const origin = originOf(tab.url);
              const id = `${origin}|${name}`;
              const ch = /^space$/i.test(key.split("+").pop() ?? "") ? " " : (key.split("+").pop() ?? "");
              let row = this.keyRows.get(id);
              if (!row) {
                row = { name, value: "", origin, fieldType: "plain" };
                this.keyRows.set(id, row);
                this.turn.filled.push(row);
              }
              row.value = (row.value + (/^shift\+/i.test(key) ? ch.toUpperCase() : ch)).slice(0, 120);
            }
            return ok(`Pressed ${key}.`);
          },
        };
      }
      case "scroll": {
        const direction = (str("direction") ?? "down") as "up" | "down" | "left" | "right";
        const amount = num("amount") ?? 1;
        const ref = str("ref");
        return {
          label: `Scroll ${direction}${amount !== 1 ? ` ×${amount}` : ""}`,
          sensitive: false,
          run: async () => {
            const info = await this.send<PageInfo>(await this.currentTabId(), {
              type: "enki:scroll",
              direction,
              amount,
              ref,
            });
            return ok(`Scrolled ${direction}. Now at ${info.scroll.y}/${info.scroll.maxY}px.`);
          },
        };
      }
      case "wait": {
        const seconds = Math.min(Math.max(num("seconds") ?? 2, 0.2), 10);
        return {
          label: `Wait ${seconds}s`,
          sensitive: false,
          run: async () => {
            await sleep(seconds * 1000);
            return ok(`Waited ${seconds}s.`);
          },
        };
      }
      case "switch_tab": {
        const tabId = num("tab_id");
        // A tab in another window is refused before anything runs, and again at run time in case
        // it moved in between: Enki never switches to, or acts in, another window's tab.
        if (tabId !== undefined) {
          const planned = await chrome.tabs.get(tabId).catch(() => null);
          if (planned && planned.windowId !== this.windowId) throw new TabInOtherWindowError(otherWindowStop(planned));
        }
        return {
          label: `Switch to tab ${tabId}`,
          sensitive: false,
          run: async () => {
            if (tabId === undefined) throw new Error("tab_id is required.");
            const target = await chrome.tabs.get(tabId);
            if (target.windowId !== this.windowId) throw new TabInOtherWindowError(otherWindowStop(target));
            const tab = await chrome.tabs.update(tabId, { active: true });
            this.retarget(tabId);
            await this.applyOverlay();
            const where = this.wrap(`${tab?.title ?? ""} — ${tab?.url ?? ""}`, "switch_tab", tab?.url);
            return ok(`Switched to ${where}.`);
          },
        };
      }
      case "new_tab": {
        let url = (str("url") ?? "").trim();
        if (url) {
          if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
          if (!isValidWebNavigationUrl(url)) {
            throw new Error(`Security restriction: Cannot open new tab with "${url}". Only standard http/https web URLs are allowed.`);
          }
        }
        // Empty URL opens the browser's own new-tab page — never a search engine.
        const targetUrl = url || "chrome://newtab/";
        const current = await this.currentTab().catch(() => null);
        const meta = url
          ? this.planFrom({
              tool: "new_tab",
              currentUrl: current?.url,
              destinationUrl: targetUrl,
              incognito: !!current?.incognito,
              label: `Open new tab: ${targetUrl}`,
            })
          : { label: "Open new tab", sensitive: false as boolean };
        return {
          ...meta,
          run: async () => {
            const tab = await chrome.tabs.create({ url: targetUrl, windowId: this.windowId, active: true });
            if (tab.id) this.retarget(tab.id);
            if (tab.id) await this.waitForLoad(tab.id);
            const fresh = tab.id ? await chrome.tabs.get(tab.id) : tab;
            const where = this.wrap(`${fresh.title ?? ""} — ${fresh.url ?? ""}`, "new_tab", fresh.url);
            return ok(`Opened ${where} in a new tab (id ${fresh.id}).`);
          },
        };
      }
      default: {
        const found = findTool(this.connections, call.name);
        if (found) {
          const { conn, tool } = found;
          const current = await this.currentTab().catch(() => null);
          const meta = this.planFrom(
            {
              tool: call.name,
              currentUrl: current?.url,
              connector: { app: conn.name, tool: tool.title, readOnly: !!tool.readOnly, allowed: !!tool.allowed },
              incognito: !!current?.incognito,
              label: `${conn.name}: ${tool.title}`,
            },
            !tool.readOnly && !tool.allowed,
          );
          return {
            ...meta,
            // Connector writes the user did not allow by name always ask, even with auto-approve.
            alwaysAsk: !tool.readOnly && !tool.allowed ? true : meta.alwaysAsk,
            run: async () => {
              const r = await runTool(conn, tool, input as Record<string, unknown>);
              const body = this.wrap(r.text, "connector", conn.url);
              this.rememberPageData(r.text);
              return {
                content: [text(body), ...r.images.map((i) => ({ type: "image" as const, mediaType: i.mediaType as ImagePart["mediaType"], data: i.data }))],
                isError: r.isError,
              };
            },
          };
        }
        return {
          label: call.name,
          sensitive: false,
          run: async () => ({ content: [text(`Unknown tool "${call.name}".`)], isError: true }),
        };
      }
    }
  }
}
