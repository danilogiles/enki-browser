# CLAUDE.md — Context and Commands for Enki Browser Assistant

## Commands
- **Dev Server:** `npm run dev` (Runs Vite with hot reloading for unpacked extension)
- **Typecheck:** `npm run typecheck` (Runs `tsc --noEmit`)
- **Build:** `npm run build` (Runs `tsc --noEmit && vite build`, outputs to `dist/`)
- **Tests:** `npm run test:e2e` (agent loop, tools, safety gates) and `npm run test:resilience` (badly-behaved models: stalled streams, reasoning-only replies, inline `<think>` tags). Both need `npm run mock` running in another terminal.
- **Icon Generation:** `npm run icons`

## Architecture & Code Conventions
- **Sidepanel Runtime:** React 19 + Tailwind CSS v4 in `src/sidepanel/`. The agent loop (`src/lib/agent/loop.ts`) runs here so it persists while the side panel remains open.
- **Content Script:** `src/content/content-script.ts` generates compact accessibility snapshots with `[ref_N]` handles. It does not communicate with LLMs directly.
- **Browser Executor:** `src/lib/tools/executor.ts` dispatches hardware events via Chrome DevTools Protocol (`chrome.debugger`) with DOM fallback.
- **Safety First:** Hard block on password fields, strict URL navigation whitelisting (`http://` and `https://` only), and confirmation modals for sensitive actions (`SENSITIVE_ACTION`).
- **No Heavy SDKs for OpenAI:** `src/lib/providers/openai-compat.ts` uses native `fetch` + SSE streaming. Keep it dependency-free.
- **Documentation:** See `docs/PRD.md`, `docs/ARCHITECTURE.md`, and `docs/SECURITY.md`.
