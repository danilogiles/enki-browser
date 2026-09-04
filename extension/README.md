# Enki

**An open-source AI assistant for any Chromium browser. Bring your own model.**

Enki lives in the browser side panel. It sees the page you are looking at, answers questions about it, and, when you let it, navigates, clicks and types for you. Think of the assistant in Perplexity's Comet, but free, open, and working with whichever model you already pay for (or run locally).

Works in Chrome, Edge, Brave, Arc, Vivaldi, Opera and any other Chromium-based browser (Chrome 116+).

## Features

- **Ask mode**: chat with the page. Enki reads the DOM, the text, and a screenshot of what you see.
- **Act mode**: give it a task. Enki navigates, clicks, types, scrolls and manages tabs, observing the page between steps.
- **Bring your own model**: Anthropic Claude, OpenAI, Google Gemini, Groq, OpenRouter, Ollama (local), or any OpenAI-compatible endpoint.
- **Safety first**: sensitive clicks (send, buy, delete, publish...) show a confirmation card before they run. Enki never types passwords or payment details, never solves CAPTCHAs, and treats page text as data, not instructions.
- **Private**: your API key lives in the browser's local extension storage and is sent only to the provider you chose. No backend, no telemetry.

Planned for a later phase: a **companion mode** that watches your browsing and proactively offers suggestions.

## Install (developer mode)

Enki is not on the Chrome Web Store yet. Load it unpacked:

```bash
git clone https://github.com/devopsfuturasync/enkibrowser.git
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
2. **Connect in Enki:** In Settings ⚙️, choose **OmniRoute**, verify `http://localhost:20128/v1`, set model to `auto` (alternatives: `auto/cheap`, `auto/fast`, `auto/best-free`), press the refresh button, and save.
3. The free pool has no reliable vision models, so the OmniRoute preset turns off image support automatically and works from the page DOM. If you add your own vision-capable keys to OmniRoute, turn images back on in Settings.

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
- 🛡️ **[Security Policy](docs/SECURITY.md)** — Threat model, defense against indirect prompt injection, and credential protection gates.
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

Issues and pull requests are welcome. Please read [AGENTS.md](AGENTS.md) and [docs/SECURITY.md](docs/SECURITY.md) to ensure safety rules and type checks remain strictly intact.

## License

MIT. See [LICENSE](LICENSE).
