# Egress & no-analytics audit

**Date:** 2026-09-21  
**Tree:** `danilogiles/enkibrowser` `main` (tarball snapshot)  
**Auditor:** Cloak (P0 sprint)

## Method
- Inspect `package.json` dependencies / devDependencies for analytics SDKs.
- Ripgrep for analytics/telemetry product names and common beacon patterns.
- Map hardcoded provider `baseUrl` values in `src/lib/settings.ts` and fetch construction in providers.

## Dependencies
Runtime: `@anthropic-ai/sdk`, `lucide-react`, `react`, `react-dom`, `react-markdown`, `zod`.  
Dev: Vite, CRXJS, Tailwind, TypeScript, Sharp, Chrome types.  

**Finding:** No Sentry, PostHog, Mixpanel, Segment, Amplitude, Plausible, gtag, or similar analytics SDK.

## Code references to “telemetry” / “analytics”
Matches are **policy prose** in README / PRIVACY_POLICY / PRD (claims of *no* telemetry), UI type name `Segment` (chat message parts — not Segment.io), and ARCHITECTURE “beacon” meaning a **click flash** overlay — not a network beacon.

## Expected network egress (AI)
Only when the user configures a provider and runs Ask/Act (or connection test):

| Preset | Default base URL |
|---|---|
| OmniRoute | `http://localhost:20128/v1` |
| Ollama | `http://localhost:11434/v1` |
| Anthropic | `https://api.anthropic.com` |
| OpenAI | `https://api.openai.com/v1` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Groq | `https://api.groq.com/openai/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Custom | User-supplied |

Keys and page context go to **that** endpoint only. No Futurasync collector.

## OmniRoute smoke allowlist (Danilo local)
When provider = OmniRoute: expect traffic to **`localhost:20128`** (and whatever upstream OmniRoute itself calls — outside Enki’s process). Enki must not open additional analytics hosts during Ask/Act.

## Non-AI URL notes (not telemetry)
- Chrome Web Store URL blocked for navigation safety.
- `new_tab` without URL falls back to `https://google.com` — product follow-up (prefer DDG/NTP), not a phone-home.

## Verdict
**Pass** for no product analytics SDK / no surprise telemetry host in the extension bundle. Re-run this audit when adding dependencies or a browser shell updater.
