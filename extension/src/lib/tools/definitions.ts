import type { ToolDefinition } from "../types";

/** Tools that only observe the page. Available in "Ask" mode. */
export const READ_TOOLS: ToolDefinition[] = [
  {
    name: "read_page",
    description:
      "Get a compact accessibility snapshot of the current tab: every visible interactive element with a [ref_N] handle you can pass to click/type/scroll, plus headings and text when filter=all. Call this after any navigation or click that changes the page.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["interactive", "all"],
          description: "interactive (default) = only clickable/typable elements. all = also headings, text and images.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "find",
    description:
      "Search the current page for elements whose role, label, text, href, id or class contain all the given words (case-insensitive). Returns up to 20 matches with [ref_N] handles. Cheaper than read_page when you know what you are looking for.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: 'e.g. "sign in button", "search", "add to cart"' } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_page_text",
    description:
      "Return the readable text content of the current tab (main article when present). Use it to read, summarize or answer questions about the page content.",
    inputSchema: {
      type: "object",
      properties: {
        max_chars: { type: "integer", description: "Truncate after this many characters (default 20000)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "screenshot",
    description:
      "Take a screenshot of the visible part of the current tab. Coordinates in the image map 1:1 to click(x, y). Use it when layout, images, charts or visual state matter, or when the DOM snapshot is not enough.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_tabs",
    description: "List the open tabs in the current window with their ids, titles and URLs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

/** Tools that change the page or the browser. Only available in "Act" mode. */
export const ACT_TOOLS: ToolDefinition[] = [
  {
    name: "navigate",
    description:
      'Navigate the current tab to a URL, or go "back" / "forward" in history. Waits for the page to load and returns its title and URL. Follow with read_page.',
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: 'Full URL (https://...), or "back" / "forward".' },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "click",
    description:
      "Click an element. Prefer ref (from read_page/find). Use x,y (from a screenshot) only when no ref is available. The page is scrolled so the element is visible before clicking.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Element handle like ref_12." },
        x: { type: "number", description: "Screenshot x coordinate (CSS px)." },
        y: { type: "number", description: "Screenshot y coordinate (CSS px)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "type",
    description:
      "Type text into an input, textarea or editable element. Focuses the element first. Existing content is replaced unless append=true. Set submit=true to press Enter afterwards (e.g. search boxes).",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Element handle like ref_12. Omit to type into whatever is focused." },
        text: { type: "string" },
        append: { type: "boolean", description: "Keep existing content and append (default false)." },
        submit: { type: "boolean", description: "Press Enter after typing (default false)." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "press_key",
    description:
      'Press a key or shortcut on the page: "Enter", "Escape", "Tab", "ArrowDown", "Backspace", "ctrl+a", "shift+Tab"...',
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "scroll",
    description:
      "Scroll the page (or a scrollable element given by ref) by a number of screens. Returns the new scroll position.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "left", "right"] },
        amount: { type: "number", description: "Screens to scroll (default 1)." },
        ref: { type: "string", description: "Scroll inside this element instead of the page." },
      },
      required: ["direction"],
      additionalProperties: false,
    },
  },
  {
    name: "wait",
    description: "Wait for the page to settle (max 10 seconds). Use after actions that trigger loading.",
    inputSchema: {
      type: "object",
      properties: { seconds: { type: "number", description: "Default 2." } },
      additionalProperties: false,
    },
  },
  {
    name: "switch_tab",
    description: "Make another tab the current tab (ids from list_tabs).",
    inputSchema: {
      type: "object",
      properties: { tab_id: { type: "integer" } },
      required: ["tab_id"],
      additionalProperties: false,
    },
  },
  {
    name: "new_tab",
    description: "Open a URL in a new tab and make it the current tab.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
];

export const ALL_TOOLS: ToolDefinition[] = [...READ_TOOLS, ...ACT_TOOLS];

export function toolsForMode(mode: "ask" | "act", vision = true): ToolDefinition[] {
  const tools = mode === "act" ? ALL_TOOLS : READ_TOOLS;
  return vision ? tools : tools.filter((t) => t.name !== "screenshot");
}
