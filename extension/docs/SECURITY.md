# Security Policy & Defense-in-Depth — Enki Browser Assistant

Enki operates inside the user's personal browser where private sessions, cookies, and authenticated dashboards reside. Security is therefore not an afterthought—it is a core design constraint.

---

## 1. Threat Model

We analyze four primary attack vectors relevant to autonomous browser extensions:

| Attack Vector | Threat Description | Enki Defense Strategy |
|---|---|---|
| **Indirect Prompt Injection** | Malicious text embedded on third-party web pages instructing the AI to perform unauthorized actions or leak sensitive information. | Structural separation: page text is treated strictly as untrusted data. Explicit negative instructions in system prompt. Sensitive action gating. |
| **Credential Theft** | Prompt injection attempting to extract or submit passwords, OTP tokens, or credit cards. | Hard code-level block on typing into fields with `type="password"` or `autocomplete="*password*"`. Strict instructions never to read or type credentials. |
| **Unauthorized Action / CSRF** | The AI unwittingly clicking "Delete Account", "Confirm Purchase", or "Send Message" without user consent. | Multilingual heuristic detection (`SENSITIVE_ACTION`) triggering interactive modal approval cards before execution. |
| **Malicious URL Redirection** | Navigating the browser to `javascript:`, internal browser URLs (`chrome://settings`), or dangerous schemes. | Strict URL protocol filtering: only standard `http://` and `https://` schemes are permitted. |

---

## 2. In-Depth Security Mechanisms

### 2.1 Code-Level Password Gate
Even if an LLM is deceived into attempting to type into a password field, the browser executor aborts immediately:
```ts
// src/lib/tools/executor.ts
if (target?.isPassword) {
  throw new Error(
    "Security restriction: Enki is prevented from typing into password or credential fields for safety. Please enter credentials manually."
  );
}
```

### 2.2 Navigation Protocol Whitelisting
Enki rejects any attempt to execute script payloads or inspect internal browser state:
```ts
// src/lib/tools/executor.ts
const RESTRICTED_URL = /^(chrome|edge|brave|opera|vivaldi|arc|about|chrome-extension|devtools|view-source|file|javascript|data):/i;

export function isValidWebNavigationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !isRestrictedUrl(url);
  } catch {
    return false;
  }
}
```

### 2.3 Interactive Human-in-the-Loop Confirmation
For potentially destructive, financial, or outward-facing actions, execution is paused until the user explicitly clicks **Allow**:
- Triggered by regex matching across English, Portuguese, and Spanish keywords (`buy`, `pay`, `confirm`, `delete`, `send`, `publish`, `transfer`, `checkout`, `comprar`, `pagar`, `excluir`, `enviar`, etc.).
- Form submission buttons on non-search forms automatically trigger sensitivity checks.

### 2.4 Data Privacy & Key Storage
- **Local Storage Isolation:** API keys are stored solely in `chrome.storage.local`.
- **No Shared Content Access:** Content scripts injected into web pages cannot access `chrome.storage.local`. The API key is never transmitted to the web page DOM or third-party tracking endpoints.
- **Direct Provider Connection:** Network requests travel directly from the user's browser extension to the configured LLM API (Anthropic, OpenAI, Google, Groq, or local gateway).
- **Conversation Storage (since 0.2.0):** When *Save conversations on this device* is on (the default), the latest conversation is written to `chrome.storage.local` so the panel can restore it. This includes your prompts and the page text that tools returned. Screenshots and model reasoning are stripped before saving. The copy never leaves the device; turning the setting off or starting a new chat deletes it.
- **Diagnostic Log Buffer:** `src/lib/debug.ts` always records a 400-entry in-memory ring buffer, which can contain URLs, tool arguments and page-text excerpts. It is never persisted and never sent anywhere. The Logs view that renders it is gated behind the **Developer mode** setting; the *Copy diagnostics* export is a separate, allowlisted report that excludes URLs, page content, prompts, credentials and raw error strings.

---

## 3. Responsible Disclosure

If you discover a security vulnerability in Enki, please contact the maintainers via GitHub Issues or security advisory. We treat all security reports with high urgency.
