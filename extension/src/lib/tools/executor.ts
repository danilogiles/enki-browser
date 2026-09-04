/**
 * Executes browser tools from the side panel. Uses the content script for DOM reads and
 * element location, and the Chrome DevTools Protocol (chrome.debugger) for trusted mouse and
 * keyboard input, falling back to DOM-level actions when the debugger cannot attach.
 */
import type { ImagePart, TextPart, ToolCallPart } from "../types";
import type { ContentRequest, ContentResponse, LocatedElement, PageInfo } from "../protocol";
import { SENSITIVE_ACTION } from "../protocol";

export type ToolOutput = { content: Array<TextPart | ImagePart>; isError?: boolean };

export type ToolPlan = {
  /** Human-readable description shown in the UI, e.g. `Click "Sign in"`. */
  label: string;
  /** True when the action deserves a confirmation card before running. */
  sensitive: boolean;
  run: () => Promise<ToolOutput>;
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
  private attached = new Set<number>();
  private screenshotScale = 1;

  constructor(private readonly windowId: number) {
    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId) this.attached.delete(source.tabId);
    });
  }

  // ---------- tab helpers ----------

  async currentTab(): Promise<chrome.tabs.Tab> {
    const [tab] = await chrome.tabs.query({ active: true, windowId: this.windowId });
    if (!tab?.id) throw new Error("No active tab in this window.");
    return tab;
  }

  private async currentTabId(): Promise<number> {
    return (await this.currentTab()).id!;
  }

  private async send<T>(tabId: number, req: ContentRequest): Promise<T> {
    const tab = await chrome.tabs.get(tabId);
    if (isRestrictedUrl(tab.url)) {
      throw new Error(
        `This tab (${tab.url ?? "internal page"}) is a browser-internal page and cannot be read or controlled. Navigate to a website first.`,
      );
    }
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
  }

  // ---------- CDP helpers ----------

  private async attach(tabId: number): Promise<boolean> {
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

  /** Detach the debugger from every tab. Call when a turn ends so the info bar goes away. */
  async release(): Promise<void> {
    for (const tabId of [...this.attached]) {
      await chrome.debugger.detach({ tabId }).catch(() => undefined);
      this.attached.delete(tabId);
    }
  }

  private async clickAt(tabId: number, x: number, y: number, fallbackRef?: string): Promise<void> {
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
          run: async () => ok(await this.send<string>(await this.currentTabId(), { type: "enki:snapshot", filter })),
        };
      }
      case "find": {
        const query = str("query") ?? "";
        return {
          label: `Find "${query}"`,
          sensitive: false,
          run: async () => ok(await this.send<string>(await this.currentTabId(), { type: "enki:find", query })),
        };
      }
      case "get_page_text":
        return {
          label: "Read page text",
          sensitive: false,
          run: async () =>
            ok(
              await this.send<string>(await this.currentTabId(), {
                type: "enki:text",
                maxChars: num("max_chars"),
              }),
            ),
        };
      case "screenshot":
        return {
          label: "Take screenshot",
          sensitive: false,
          run: async () => {
            const shot = await this.screenshot();
            const { width, height, ...img } = shot;
            return { content: [text(`Screenshot ${width}x${height}. Coordinates map 1:1 to click(x, y).`), img] };
          },
        };
      case "list_tabs":
        return {
          label: "List tabs",
          sensitive: false,
          run: async () => {
            const tabs = await chrome.tabs.query({ windowId: this.windowId });
            return ok(
              tabs
                .map((t) => `${t.active ? "* " : "  "}[${t.id}] ${t.title ?? ""} — ${t.url ?? ""}`)
                .join("\n"),
            );
          },
        };
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
        return {
          label: isHistory ? `Go ${url}` : `Go to ${url}`,
          sensitive: false,
          run: async () => {
            const tabId = await this.currentTabId();
            if (url === "back") await chrome.tabs.goBack(tabId);
            else if (url === "forward") await chrome.tabs.goForward(tabId);
            else await chrome.tabs.update(tabId, { url });
            await this.waitForLoad(tabId);
            const tab = await chrome.tabs.get(tabId);
            return ok(`Now on "${tab.title ?? ""}" — ${tab.url ?? ""}. Call read_page to see its content.`);
          },
        };
      }
      case "click": {
        const ref = str("ref");
        const x = num("x");
        const y = num("y");
        const tabId = await this.currentTabId();
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
        return {
          label,
          sensitive: t.sensitive,
          run: async () => {
            await this.clickAt(tabId, t.x, t.y, ref);
            await sleep(500);
            const tab = await chrome.tabs.get(tabId);
            return ok(`Clicked ${t.role}${t.name ? ` "${t.name}"` : ""}. Page is now "${tab.title ?? ""}" — ${tab.url ?? ""}. Call read_page or screenshot to see the result.`);
          },
        };
      }
      case "type": {
        const ref = str("ref");
        const value = str("text") ?? "";
        const append = bool("append");
        const submit = bool("submit");
        const tabId = await this.currentTabId();
        let target: LocatedElement | null = null;
        if (ref) target = await this.send<LocatedElement>(tabId, { type: "enki:locate", ref });
        if (target?.isPassword) {
          throw new Error("Security restriction: Enki is prevented from typing into password or credential fields for safety. Please enter credentials manually.");
        }
        const preview = value.length > 40 ? value.slice(0, 40) + "…" : value;
        const label = `Type "${preview}"${target?.name ? ` into "${target.name}"` : ""}${submit ? " and press Enter" : ""}`;
        return {
          label,
          sensitive: submit && !!target && !/search|buscar|pesquisar|procurar/i.test(`${target.name} ${target.role}`) && SENSITIVE_ACTION.test(target.name),
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
            if (submit) {
              await sleep(120);
              await this.pressKey(tabId, "Enter");
              await this.waitForLoad(tabId, 8000);
            }
            return ok(`Typed into ${target?.name ? `"${target.name}"` : "the focused element"}${submit ? " and pressed Enter" : ""}.`);
          },
        };
      }
      case "press_key": {
        const key = str("key") ?? "";
        return {
          label: `Press ${key}`,
          sensitive: false,
          run: async () => {
            const tabId = await this.currentTabId();
            await this.pressKey(tabId, key);
            await sleep(300);
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
        return {
          label: `Switch to tab ${tabId}`,
          sensitive: false,
          run: async () => {
            if (tabId === undefined) throw new Error("tab_id is required.");
            const tab = await chrome.tabs.update(tabId, { active: true });
            return ok(`Switched to "${tab?.title ?? ""}" — ${tab?.url ?? ""}.`);
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
        const targetUrl = url || "https://google.com";
        return {
          label: `Open new tab: ${targetUrl}`,
          sensitive: false,
          run: async () => {
            const tab = await chrome.tabs.create({ url: targetUrl, windowId: this.windowId, active: true });
            if (tab.id) await this.waitForLoad(tab.id);
            const fresh = tab.id ? await chrome.tabs.get(tab.id) : tab;
            return ok(`Opened "${fresh.title ?? ""}" — ${fresh.url ?? ""} in a new tab (id ${fresh.id}).`);
          },
        };
      }
      default:
        return {
          label: call.name,
          sensitive: false,
          run: async () => ({ content: [text(`Unknown tool "${call.name}".`)], isError: true }),
        };
    }
  }
}
