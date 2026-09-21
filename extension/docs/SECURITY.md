# Security Policy & Defense-in-Depth — Enki

Enki operates inside the user's personal browser where private sessions, cookies, and authenticated dashboards reside. Security is a core design constraint — for the MV3 side-panel assistant today and for the full Chromium browser destination.

**Related:** [SHIELDS.md](./SHIELDS.md) (privacy defaults) · [EGRESS_AUDIT.md](./EGRESS_AUDIT.md) (no-analytics / host allowlist) · [PRIVACY_POLICY.md](./PRIVACY_POLICY.md)

---

## 1. Threat Model (extension era — shipped)

| Attack Vector | Threat Description | Enki Defense Strategy |
|---|---|---|
| **Indirect Prompt Injection** | Malicious text on third-party pages instructing the AI to act or leak data. | Page text is **untrusted data**, not instructions. System-prompt negatives + sensitive-action gating. |
| **Credential Theft** | Prompt injection trying to extract or submit passwords, OTPs, or cards. | Hard block on typing into `type="password"` / password-like `autocomplete`. Never read or type credentials. |
| **Unauthorized Action / CSRF** | AI clicking Delete / Buy / Send without consent. | Multilingual `SENSITIVE_ACTION` heuristics → Allow/Deny card before execution. |
| **Malicious URL Redirection** | Navigate to `javascript:`, `chrome://`, `file:`, `data:`, etc. | Only `http://` and `https://` navigations allowed. |
| **Silent data exfil (product)** | Extension phoning home with history or keys. | No Futurasync backend; no product telemetry; keys stay in `chrome.storage.local`; LLM traffic goes browser → chosen provider (or localhost gateway) only. |
| **Silent history exfil (AI)** | Agent or Companion Mode uploading browsing history without consent. | Ask/Act only send page context when the user starts a turn. **Companion Mode is Off** until kill-criteria below are met. |

---

## 2. Shipped mechanisms (MV3 assistant)

### 2.1 Password / credential gate
```ts
// src/lib/tools/executor.ts
if (target?.isPassword) {
  throw new Error(
    "Security restriction: Enki is prevented from typing into password or credential fields for safety. Please enter credentials manually."
  );
}
```

### 2.2 Navigation protocol allowlist
```ts
// src/lib/tools/executor.ts
const RESTRICTED_URL = /^(chrome|edge|brave|opera|vivaldi|arc|about|chrome-extension|devtools|view-source|file|javascript|data):/i;
// Only http: / https: pass isValidWebNavigationUrl
```

### 2.3 Human-in-the-loop sensitive actions
Multilingual keyword heuristics (`buy`, `pay`, `delete`, `send`, `publish`, `checkout`, `comprar`, `pagar`, `excluir`, `enviar`, …) and non-search form submits pause the loop until the user clicks **Allow**.

### 2.4 Keys, storage, diagnostics
- **API keys:** `chrome.storage.local` only. Content scripts cannot read them. Never injected into page DOM.
- **Direct provider connection:** HTTPS (or localhost) to the user-configured endpoint — Anthropic, OpenAI, Gemini, Groq, OpenRouter, Ollama, OmniRoute, or custom OpenAI-compatible. No Enki proxy.
- **Conversation storage (0.2.0+):** When *Save conversations on this device* is on (default), the latest conversation is restored from `chrome.storage.local` (prompts + tool page text). Screenshots and model reasoning are stripped before save. Never leaves the device; turning the setting off or starting a new chat deletes it.
- **Diagnostic log buffer:** `src/lib/debug.ts` keeps a 400-entry **in-memory** ring (may include URLs, tool args, page-text excerpts). Never persisted, never sent. Logs UI is behind **Developer mode**. *Copy diagnostics* is a separate allowlisted export that excludes URLs, page content, prompts, credentials, and raw error strings.

### 2.5 Ask vs Act
- **Ask:** read-only tools (`read_page`, `find`, `get_page_text`, `screenshot`, `list_tabs`).
- **Act:** plus mutate tools, still under password / URL / sensitive-action gates.

---

## 3. AI egress rules (non-negotiable)

1. Page DOM text, accessibility snapshots, and screenshots leave the device **only** when the user starts an **Ask** or **Act** turn (or another feature that has explicit, documented consent).
2. Enki does **not** read or upload the browser history store, cookies, password manager, or autofill database.
3. Keys stay local. BYOM forever — any provider / OpenAI-compat / Ollama / local gateway.
4. No spy telemetry. Crash reports, if ever added, are **opt-in** and documented in the **same PR** as the code.
5. Custom endpoints: prefer HTTPS; warn on plain `http://` except localhost.
6. Shields (tracker/HTTPS/fingerprint) must **not** duplicate or weaken agent-loop safety gates — coordinate UX with Spark (e.g. future “sent page context to {provider}” chip).

---

## 4. Companion Mode — kill-criteria (Off until all met)

Companion Mode (PRD: passive observer that watches browsing) is **not shipped** and stays **Off** by default until every item below is true and documented:

| # | Criterion |
|---|---|
| C1 | Default is **on-device only** — no network calls for companion suggestions unless the user opts in. |
| C2 | Any cloud/provider call requires **explicit** per-session or per-feature consent (not buried in a long ToS). |
| C3 | UI shows a **visible egress summary** (what left the device: URLs? titles? DOM? screenshots? → which endpoint). |
| C4 | Never auto-upload full browsing history, cookie jar, or password store. |
| C5 | Can be disabled in one click; disabling stops all companion network activity immediately. |
| C6 | SECURITY.md + PRIVACY_POLICY.md updated in the **same PR** as the feature. |

Until then: no companion code path that observes tabs in the background for model prompts.

---

## 5. Destination: full Chromium browser

Privacy pack defaults (tracker/ad, HTTPS-Only, fingerprint tiers, DuckDuckGo search, cookie partitioning) live in [SHIELDS.md](./SHIELDS.md). Implementation is phase 2+ with Blink (thin fork). Extension-era interim: the **host** browser’s shields apply; Enki must not weaken them.

### 5.1 Safe Browsing (interim)
Keep Google Safe Browsing **with clear in-product disclosure** until Cloak ships a substitute. Do not strip phishing/malware protection at P1.

### 5.2 Clean-room licensing
Shields implementations use **MIT/Apache** (or equivalently permissive) open lists and patches only. Do **not** copy Brave MPL-licensed code without legal review (escalate to Leonidas / Danilo).

### 5.3 Crash / telemetry
None today. Future crash reports: opt-in only + same-PR docs.

---

## 6. Responsible Disclosure

If you discover a security vulnerability in Enki, please contact the maintainers via GitHub Issues or a private security advisory. We treat security reports with high urgency.
