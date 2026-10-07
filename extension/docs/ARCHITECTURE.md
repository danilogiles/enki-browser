# Architecture & System Design — Enki Browser Assistant

This document outlines the software architecture, component relationships, data flow, and runtime mechanics of **Enki**.

---

## 1. System Architecture Overview

Enki is structured as a Chrome Manifest V3 extension with three principal runtime contexts:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          ENKI SYSTEM TOPOLOGY                          │
└────────────────────────────────────────────────────────────────────────┘

 ┌─────────────────────────┐                ┌──────────────────────────┐
 │  Background SW          │                │  Side Panel UI (React)   │
 │  (service-worker.ts)    │                │  - App.tsx / Chat.tsx    │
 │  - Action click binding │                │  - Agent Loop (loop.ts)  │
 │  - Keyboard shortcut    │                │  - Settings & Providers  │
 └───────────┬─────────────┘                └─────────────┬────────────┘
             │                                            │
             │ opens                                      │ chrome.debugger
             ▼                                            │ chrome.tabs
 ┌─────────────────────────┐                              ▼
 │ Active Browser Window   │◀─────────────────────────────┤
 └───────────┬─────────────┘                              │
             │                                            │ chrome.tabs.sendMessage
             │ content script                             │ (ContentRequest)
             ▼                                            │
 ┌─────────────────────────┐                              │
 │ Content Script          │◀─────────────────────────────┘
 │ (content-script.ts)     │
 │ - Accessibility snapshot│
 │ - Ref mapping [ref_N]   │
 │ - DOM interaction       │
 └─────────────────────────┘
```

---

## 2. Core Components

### 2.1 Side Panel Runtime (`src/sidepanel/`)
The agent loop runs inside the extension side panel. Unlike ephemeral popup windows, the side panel maintains its execution context while open, allowing long-running multi-turn tasks to proceed uninterrupted.
- **`App.tsx`**: Orchestrator that binds UI state, active tab subscriptions, model settings, and coordinates agent turns.
- **`Chat.tsx`**: Renders message bubbles, streaming markdown output, collapsible reasoning thoughts, tool execution chips, and the sensitive action approval card.
- **`Composer.tsx`**: Input prompt box, mode indicators (Ask vs. Act), token usage counters, and screenshot attachment toggle.
- **`SettingsView.tsx`**: Provider configuration, API key input, base URL customization, live model testing, and vision toggles.

### 2.2 Agentic Execution Loop (`src/lib/agent/`)
- **`loop.ts (`runTurn`)`**: Drives the iterative tool-call cycle:
  1. Streams model completions and tool call proposals.
  2. Parses tool calls and checks for sensitive actions.
  3. Pauses for human confirmation if `plan.sensitive === true` and `autoApprove === false`.
  4. Dispatches tool execution to `BrowserExecutor`.
  5. Feeds tool results back into history for the subsequent turn until the model signals `done` or hits `maxSteps`.
- **`prompt.ts (`buildSystemPrompt`)`**: Constructs the static system prompt based on mode (`ask` or `act`), instilling safety directives, element citation requirements, and indirect prompt injection defenses.

### 2.3 Browser Executor (`src/lib/tools/executor.ts`)
Encapsulates all interaction with the active browser window:
- **Chrome DevTools Protocol (CDP)**: Uses `chrome.debugger` (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText`) to execute hardware-level user interactions that bypass synthetic event listeners.
- **DOM Fallback**: When CDP cannot attach (e.g. permission constraints), falls back to DOM events (`element.click()`, `setValue()`, `element.focus()`).
- **Safety Gate**: Verifies URLs with `isValidWebNavigationUrl()` and blocks typing into password fields via `target.isPassword`.

### 2.4 Content Script (`src/content/content-script.ts`)
Injected on `<all_urls>` at `document_idle`.
- **Accessibility Snapshot (`snapshot`)**: Traverses visible elements, assigning ephemeral `ref_N` keys, computing ARIA roles, cleaned labels, and scroll positions.
- **`locate(ref)`**: Computes center viewport coordinates, checks if the element is inside a form submit or matches `SENSITIVE_ACTION`, and detects password/credential fields.
- **`flash(x, y)`**: Injects a temporary pulsing visual beacon into the page DOM to show where Enki clicked.

### 2.5 Provider Adapters (`src/lib/providers/`)
- **`AnthropicProvider`**: Native integration with `@anthropic-ai/sdk` for Claude models.
- **`OpenAICompatProvider`**: Lightweight, dependency-free adapter using `fetch` and Server-Sent Events (SSE) stream parsing for any OpenAI-compatible endpoint.

---

## 3. Communication Protocol

Messages sent between the Side Panel and Content Script adhere to `src/lib/protocol.ts`:

| Message Type | Direction | Payload | Return Data |
|---|---|---|---|
| `enki:ping` | Side Panel → Content | None | `"pong"` |
| `enki:page_info` | Side Panel → Content | None | `PageInfo` (URL, title, viewport, scroll) |
| `enki:snapshot` | Side Panel → Content | `filter`, `maxChars` | Text representation of DOM with `[ref_N]` |
| `enki:find` | Side Panel → Content | `query` | Up to 20 matching elements with `[ref_N]` |
| `enki:text` | Side Panel → Content | `maxChars` | Readable text content of page |
| `enki:locate` | Side Panel → Content | `ref` | `LocatedElement` (x, y, tag, role, sensitive, isPassword) |
| `enki:focus` | Side Panel → Content | `ref`, `clear` | `boolean` |
| `enki:dom_click` | Side Panel → Content | `ref` | `boolean` |
| `enki:set_value` | Side Panel → Content | `ref`, `text` | `boolean` |
| `enki:scroll` | Side Panel → Content | `direction`, `amount`, `ref` | Updated `PageInfo` |
| `enki:flash` | Side Panel → Content | `x`, `y` | `boolean` |

---

## 4. Build & Distribution

- **Bundler:** Vite 8 + `@crxjs/vite-plugin`
- **Compiler:** TypeScript 5.9 with strict typechecking (`tsconfig.json`)
- **CSS Engine:** Tailwind CSS v4 via `@tailwindcss/vite`
- **Manifest:** Generated dynamically by `manifest.config.ts` (Manifest V3)
