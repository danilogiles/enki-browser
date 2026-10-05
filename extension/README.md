# Enki

**An open-source AI assistant for any Chromium browser. Bring your own model.**

Enki lives in the browser side panel. It sees the page you are looking at, answers questions about it, and, when you let it, navigates, clicks and types for you. Think of the assistant in Perplexity's Comet, but free, open, and working with whichever model you already pay for (or run locally).

Works in Chrome, Edge, Brave, Arc, Vivaldi, Opera and any other Chromium-based browser (Chrome 116+).

## Features

- **Ask mode**: chat with the page. Enki reads the DOM, the text, and a screenshot of what you see.
- **Act mode**: give it a task. Enki navigates, clicks, types, scrolls and manages tabs, observing the page between steps.
- **Current, sourced answers**: every message carries today's date, and Enki searches the web (Brave Search, then DuckDuckGo; no key needed) and reads the sources, even pages that build themselves with JavaScript, without leaving your tab. Answers cite their links.
- **Charts and mind maps**: a table of numbers in an answer is drawn as a chart with Bar / Line / Pie / Table tabs; ```chart and ```mindmap blocks are drawn too.
- **Connected apps (MCP)**: Settings → Connections links Jira & Confluence, Linear, Notion, Sentry, GitHub or any MCP server. You sign in on the app's own page (OAuth with dynamic registration and PKCE); then ask `@jira create a ticket for this bug`. Read tools run at once; anything that changes your data waits for your OK unless you allow that tool.
- **Saved tasks**: a request you repeat, run with `/name` plus extra words, in the mode it was saved with. In Act mode it works on any site, apps without MCP included.
- **Unfiltered tone** (developer mode): Enki's own tone rules off, so the model's policy is the only filter. The browser safety rules stay on.
- **Answer page**: `src/sidepanel/index.html?q=…` answers a question in a full tab, which is how Enki Browser makes Enki its address bar search.
- **Bring your own model**: Anthropic Claude, OpenAI, Google Gemini, Groq, OpenRouter, Ollama (local), or any OpenAI-compatible endpoint.
- **Safety first**: sensitive clicks (send, buy, delete, publish...) show a confirmation card before they run. Enki never types passwords or payment details, never solves CAPTCHAs, and treats page text as data, not instructions.
- **Private**: your API key lives in the browser's local extension storage and is sent only to the provider you chose. No backend, no telemetry.

Planned for a later phase: a **companion mode** that watches your browsing and proactively offers suggestions.

## Enki Browser

Prefer a whole browser with Enki already inside? **[Enki Browser](https://github.com/danilogiles/enki-browser)** is ungoogled-chromium — Chromium without Google's services or telemetry — with Enki pinned in the toolbar, uBlock Origin Lite blocking ads, trackers and malware sites, DuckDuckGo search, HTTPS upgrades, blocked third-party cookies and fingerprint noise, all on by default. Early alpha, Windows x64.

## Install (developer mode)

Enki is not on the Chrome Web Store yet. Load it unpacked:

```bash
git clone https://github.com/danilogiles/enkibrowser.git
cd enkibrowser
npm install
npm run build
```

Then in your browser:

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick the `dist/` folder.
4. Pin Enki and click its icon, or press `Ctrl+Shift+E` (`Cmd+Shift+E` on macOS).

Open **Settings** in the panel, choose a provider, paste your API key, pick a model and save.

## Choosing a model

Pick a model that supports **images** and **tool calling**. Good options:

| Provider | Suggested model | Notes |
|---|---|---|
| NVIDIA | `nvidia/nemotron-3-ultra-550b-a55b` | **The default.** Free key from build.nvidia.com, no credit card; about 40 requests a minute. Text only (no screenshots). |
| Anthropic | `claude-opus-5` or `claude-sonnet-5` | Best at multi-step browsing. |
| OpenAI | `gpt-5` | |
| Google Gemini | `gemini-2.5-flash` | Free tier available through AI Studio. |
| Groq | a vision + tools model | Very fast, cheap. |
| OpenRouter | anything with vision and tools | One key, many models. |
| OmniRoute | `auto` | Free. Local gateway that routes to 150+ free providers automatically. See below. |
| Ollama | `qwen3-vl` or another vision model with tools | Runs locally, free. Start Ollama with `OLLAMA_ORIGINS=chrome-extension://*` so the extension can reach it. |

### Free models with OmniRoute

[OmniRoute](https://github.com/diegosouzapw/OmniRoute) is an open-source AI gateway you run on your own machine. It exposes one OpenAI-compatible endpoint and routes each request to 150+ free providers automatically, falling back when a quota runs out.

#### Step 1: Install OmniRoute
Follow the install and start instructions in the official repository, [github.com/diegosouzapw/OmniRoute](https://github.com/diegosouzapw/OmniRoute). Enki links to the same page from Settings, so the steps stay correct as upstream changes them.

#### Step 2: Configure OmniRoute for Enki
1. **Docker with Playwright (Recommended for Docker users):** The official Docker image is minimal and lacks Chromium/Playwright binaries, causing `Playwright is not available` 502 errors on browser-based model routes. Use the included setup:
   ```bash
   docker compose up -d --build
   ```
   *(See [`docker/README.md`](docker/README.md) for full guide).*
2. **Connect in Enki:** In Settings ⚙️, choose **OmniRoute**, verify `http://localhost:20128/v1`, pick a model from the **Recommended** dropdown under Model (the default, `cfp/moonshotai/kimi-k2.6`, needs no key), and save. `auto` is in the list too, but it only becomes reliable once you connect your own keys in OmniRoute.
3. **If the connection test says 401:** running OmniRoute in Docker with `NODE_ENV=production` gates its API, so `GET /v1/models` answers `401 Authentication required` while `POST /v1/chat/completions` still works without a key. Enki detects this — the test falls back to a one-token chat probe and reports *"Chat works; this endpoint needs a key only to list models"*. Type the model id (`auto`) by hand, or create a key in the dashboard at `http://localhost:20128` to get the model list too.
4. The free pool has no reliable vision models, so the OmniRoute preset turns off image support automatically and works from the page DOM. If you add your own vision-capable keys to OmniRoute, turn images back on in Settings.
5. **If `auto` fails with "OmniRoute tried N providers… and all of them failed":** the keyless pool behind `auto` depends on free upstreams that block or rate-limit third-party traffic (OpenCode's free tier now answers 403 outside its own app, Felo returns 429, DuckDuckGo trips its anti-abuse check). Retrying rarely helps. Either pick a specific keyless model — `cfp/moonshotai/kimi-k2.6` and `cfp/zai-org/glm-5.2` (Cloudflare Playground) complete multi-step Act tasks — or connect a free key (Google AI Studio, Groq, OpenRouter) in the OmniRoute dashboard, which is the reliable option.

#### Compatibility mode

OmniRoute's keyless routes forward only user and assistant text: the system prompt, the `tools` array and every tool-result message are dropped before the model sees them. With native tool calling the model never learns it can browse, so it answers *"Navegando…"* and nothing happens. Cloudflare Playground also rejects any single message over 6,000 characters.

**Compatibility mode** (Settings → Behavior, on by default for the OmniRoute preset) works around both. Enki moves its instructions and a tool catalogue into the first user message, asks the model to call tools by writing `{"tool": "...", "arguments": {...}}` blocks, shows earlier calls and results back as plain chat text, and splits long messages under the cap. The agent loop's existing text recovery turns those blocks into real tool calls, with the same safety gates — only Enki's own tools ever run. Turn it off if you point OmniRoute at providers with native tool calling. `node test/live-omniroute.mjs [model] [task]` runs one Act task against a local OmniRoute after `npm run build`.

### How Enki keeps track of the browser

A page snapshot is true only for the instant it was taken. Left in the transcript they pile up — each `read_page` is several thousand tokens — and they contradict each other, so by the third request the model is looking at several versions of "the page" and can answer from a stale one or believe it is somewhere it no longer is. That is the usual reason a browser agent works on the first request and drifts afterwards.

Before every request Enki collapses superseded observations to a one-line marker, drops older screenshots, and keeps the live tab header on the newest message only. The model therefore sees exactly one authoritative view of the browser: the current one. Turn the Logs on to watch it — each step reports `contextChars` and how much a compaction freed.

Conversations live in the side panel and are lost when it closes; persistent history is on the roadmap.

### Debugging: developer mode

Turn on **Developer mode** in Settings → Behavior. A 🐞 **Logs** button appears in the header showing every provider request (endpoint, model, message and tool counts, request size, time to first chunk, finish reason, token usage), every tool call and its result, and every error. The same entries stream to the browser console — right-click the panel and choose *Inspect* to watch them live.

Copy the whole log with one button when reporting a bug. API keys are never recorded.

### If Enki says it has no tools

Free gateway pools rotate between providers, and some of them are backed by other agent
harnesses that ignore the `tools` parameter entirely. When that happens the model either says it
has no way to browse, or prints a call belonging to its own harness (`mcp__puppeteer_core__…`)
as plain text. Enki recovers what it safely can: a call naming one of its own tools is executed
even when written as text, a call naming another system's tool is never executed, and either way
you get a note explaining that the provider ignored the tool definitions. Sending the message
again usually lands on a different provider; pinning a specific model avoids it entirely.

### If a model stalls or replies with nothing

Small free and local models sometimes stop mid-task or write their whole answer into the reasoning channel. Enki handles the common cases: reasoning-only replies are shown as the answer, inline `<think>` tags are folded into the reasoning block, and a provider that goes silent fails with a message and a **Try again** button instead of spinning forever.

If a big local model on modest hardware keeps timing out, raise **Response timeout** in Settings → Behavior (default 180s), or turn off "Attach a screenshot" so each request carries far fewer tokens. Models that repeatedly stop after the first tool call are usually too small for multi-step tool use — `auto/best-free` on OmniRoute, Gemini Flash or Groq handle it better.

### Why no "log in with my Claude / ChatGPT subscription"?

Anthropic and OpenAI only allow subscription (OAuth) access from their own apps. Third-party tools like Enki must use API keys, which are billed per token. Free or cheap options are OmniRoute, Gemini's free tier, Groq, or a local Ollama model.

## Development

```bash
npm run dev
```

This starts Vite with hot reload. Load the `dist/` folder as an unpacked extension once; the side panel and content script reload as you edit.

Other scripts:

- `npm run build` - typecheck and produce `dist/`.
- `npm run typecheck` - TypeScript only.
- `npm run icons` - regenerate the PNG icons from the inline SVG logo.
- `npm run test:e2e` - run automated end-to-end tests.

## Documentation

Comprehensive project documentation is available in [`docs/`](docs/):

- 📄 **[Product Requirements Document (PRD)](docs/PRD.md)** — Vision, personas, functional requirements, and roadmap.
- 🏗️ **[System Architecture](docs/ARCHITECTURE.md)** — Deep dive into the side panel runtime, Chrome MV3 lifecycle, and CDP execution pipeline.
- 🛡️ **[Security Policy](docs/SECURITY.md)** — Threat model, AI egress rules, Companion Mode kill-criteria, credential protection gates.
- 🛡️ **[Shields](docs/SHIELDS.md)** — Tracker/HTTPS/fingerprint/search defaults (approved product posture).
- 🔎 **[Egress audit](docs/EGRESS_AUDIT.md)** — No-analytics / host allowlist snapshot.
- 🤖 **[AI Agents Guide](AGENTS.md)** & **[CLAUDE.md](CLAUDE.md)** — Context, design patterns, and constraints for AI coding agents.

## How it works

```
src/
  background/      service worker: opens the side panel, keyboard shortcut
  content/         content script: accessibility snapshot with [ref_N] handles, DOM actions, click marker
  sidepanel/       React UI (chat, tool chips, approval card, settings)
  lib/
    types.ts       provider-neutral message model
    providers/     Anthropic adapter (official SDK) + OpenAI-compatible adapter (fetch + SSE)
    tools/         browser tool definitions and the executor (CDP input via chrome.debugger, screenshots)
    agent/         agentic loop with approval gates, and the system prompt
```

- The agent loop runs inside the side panel page, so it stays alive as long as the panel is open.
- Element interaction is hybrid: the model prefers `ref_N` handles from the accessibility snapshot, and falls back to screenshot coordinates. Clicks and keystrokes go through the Chrome DevTools Protocol so they behave like real user input; when the debugger cannot attach, Enki falls back to DOM events.
- Hard security gates in code prevent the assistant from typing into password fields or navigating to malicious protocols (`javascript:`, `chrome:`).
- Potentially sensitive actions (buy, pay, delete, publish...) automatically display an approval card for user confirmation before executing.

## Contributing

Enki is built in the open and contributions are welcome — you do not need to build Chromium, just Node.js and a Chromium browser. Start with [CONTRIBUTING.md](CONTRIBUTING.md): setup, tests, what a pull request needs, and the safety rules that are not negotiable. Português e español são bem-vindos.

Found a vulnerability, or a page that makes Enki act without being asked? Report it [privately](https://github.com/danilogiles/enkibrowser/security/advisories/new), not in a public issue.

## License

MIT. See [LICENSE](LICENSE).
