# AGENTS.md — Agent & AI Coding Guide for Enki Browser Assistant

Welcome, AI Agent or Assistant! This guide provides critical architectural context, constraints, and instructions for safely and effectively contributing to the **Enki** codebase.

---

## 1. Project At A Glance

- **Repository:** `enkibrowser`
- **Product:** Open-source AI browser assistant operating inside a Chromium side panel (Manifest V3).
- **Core Stack:**
  - Runtime: Chromium Extension (MV3)
  - Build System: Vite 8 + `@crxjs/vite-plugin`
  - Language: TypeScript 5.9 (Strict mode enabled)
  - Frontend: React 19 + Tailwind CSS v4
  - Icons: `lucide-react`
  - Validation: `zod`
  - Providers: `@anthropic-ai/sdk` + native fetch SSE for OpenAI-compatible endpoints.

---

## 2. Directory Structure & Key Files

```
enkibrowser/
├── docs/
│   ├── PRD.md               # Product requirements and roadmap
│   ├── ARCHITECTURE.md      # Detailed system architecture and message flows
│   └── SECURITY.md          # Threat model and security policies
├── src/
│   ├── background/
│   │   └── service-worker.ts# Wires side panel opening and keyboard shortcut
│   ├── content/
│   │   └── content-script.ts# DOM accessibility snapshot, element locator, ref_N mapping
│   ├── lib/
│   │   ├── agent/
│   │   │   ├── loop.ts      # Agent turn cycle, tool execution, approval flow
│   │   │   └── prompt.ts    # System prompt builder (Ask and Act modes)
│   │   ├── providers/
│   │   │   ├── anthropic.ts # Anthropic SDK client
│   │   │   ├── openai-compat.ts # Zero-dependency SSE client (Gemini, Groq, OmniRoute...)
│   │   │   └── index.ts     # Provider factory
│   │   ├── tools/
│   │   │   ├── definitions.ts # Tool schemas (read_page, click, type, etc.)
│   │   │   └── executor.ts  # BrowserExecutor (CDP input via chrome.debugger, safety gates)
│   │   ├── protocol.ts      # Type definitions for messages between panel & content script
│   │   ├── settings.ts      # Storage keys, presets, default models
│   │   └── types.ts         # Generic message, stream event, and tool types
│   └── sidepanel/
│       ├── App.tsx          # Main React container
│       ├── Chat.tsx         # Message history, reasoning thoughts, tool chips
│       ├── Composer.tsx     # User input box & token counters
│       └── SettingsView.tsx # Provider configuration & live model testing
├── manifest.config.ts       # Extension manifest definition
├── package.json
└── tsconfig.json
```

---

## 3. Critical Rules for AI Agents

1. **Safety Integrity is Non-Negotiable:**
   - Never remove or bypass the `isPassword` check in `src/lib/tools/executor.ts` or `src/content/content-script.ts`.
   - Never disable `isValidWebNavigationUrl` or allow navigation to `javascript:` or internal browser schemes.
   - Never remove the `SENSITIVE_ACTION` confirmation check in `executor.ts` or `loop.ts`.
2. **Do Not Touch Content Script Entry Names:**
   - As noted in `manifest.config.ts`, CRXJS keys build outputs by filename. Entry basenames must remain unique across background, content, and sidepanel scripts.
3. **Keep Dependencies Minimal:**
   - Enki intentionally avoids heavy node polyfills or bloated libraries. The OpenAI-compatible adapter uses native `fetch` and Server-Sent Events (SSE) parsing.
4. **Preserve Type Safety:**
   - Always run `npm run typecheck` before finishing any task. There must be 0 TypeScript errors.

---

## 4. Development & Build Commands

```bash
# Install dependencies
npm install

# Start Vite dev mode with hot reload (unpacked extension auto-reloads)
npm run dev

# Check TypeScript types
npm run typecheck

# Full production build (outputs to dist/)
npm run build

# Regenerate icons from inline SVG
npm run icons

# Start the mock provider the tests talk to (separate terminal)
npm run mock

# Agent loop, tools and safety gates
npm run test:e2e

# Behaviour under badly-behaved models (stalled stream, reasoning-only reply, <think> tags)
npm run test:resilience
```

---

## 5. Typical Modification Scenarios

### Adding a New Tool
1. Define the tool schema in `src/lib/tools/definitions.ts` (`READ_TOOLS` or `ACT_TOOLS`).
2. Implement the executor logic in `src/lib/tools/executor.ts` under `prepare(call)`.
3. If DOM interaction is required, declare the request/response type in `src/lib/protocol.ts` and handle it in `src/content/content-script.ts`.

### Adding a New Provider Preset
1. Add the preset configuration in `PRESETS` array in `src/lib/settings.ts`.
2. If it requires custom headers, handle them in `src/lib/providers/openai-compat.ts`.
3. Add suggested models to `README.md` and verify connection using the refresh button in `SettingsView.tsx`.
