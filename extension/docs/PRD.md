# Product Requirements Document (PRD) — Enki Browser Assistant

**Version:** 1.0.0  
**Status:** Approved / In Active Development  
**Author:** Futurasync Team  
**Repository:** [https://github.com/devopsfuturasync/enkibrowser](https://github.com/devopsfuturasync/enkibrowser)  

---

## 1. Executive Summary

**Enki** is an open-source, Chromium-based AI browser assistant that lives directly inside the browser side panel. It empowers users to interact with any web page through natural language using their own preferred AI models (Anthropic Claude, OpenAI, Google Gemini, Groq, OpenRouter, local Ollama, or local gateways like OmniRoute).

Unlike web search engines or cloud-based browser sandbox automation tools, Enki operates **locally and securely** within the user's active browser session using Chrome Extension APIs (Manifest V3), DevTools Protocol (CDP), and DOM accessibility trees.

---

## 2. Product Goals & Value Proposition

### 2.1 Core Goals
1. **Bring Your Own Model (BYOM):** Support any modern LLM provider with vision and tool calling without vendor lock-in.
2. **Zero Cloud Telemetry & Maximum Privacy:** API keys and browsing activity stay on the client machine; no proxy servers collect user data.
3. **Safe Execution by Design:** Prevent destructive or irreversible actions through automated checks (passwords, restricted URLs) and interactive confirmation cards.
4. **Fast & Lightweight:** Built on Vite, React 19, Tailwind CSS v4, and minimal dependencies.

---

## 3. Personas & Target Audience

| Persona | Description | Primary Use Cases |
|---|---|---|
| **Developers & Engineers** | Uses local or cloud AI models for coding, scraping, debugging web apps, and automating tedious form submissions. | Navigating documentation, testing web apps, extracting structured data, automating multi-step portal workflows. |
| **Power Users & Researchers** | Gathers information across multiple tabs, reads dense papers/dashboards, compares products. | Page summarization, finding specific terms/figures, tabular data comparison. |
| **Privacy-Conscious Users** | Prefers self-hosted LLMs (Ollama) or local gateways (OmniRoute) with zero tracking. | Private browsing assistance without passing credentials to third-party services. |

---

## 4. Modes of Operation

### 4.1 "Ask" Mode (Read-Only)
- **Objective:** Answer questions and summarize without mutating the page state.
- **Allowed Tools:** `read_page`, `find`, `get_page_text`, `screenshot`, `list_tabs`.
- **Restricted Tools:** All action tools (`click`, `type`, `navigate`, `press_key`, `scroll`, `new_tab`, `switch_tab`) are disabled.

### 4.2 "Act" Mode (Autonomous Navigation & Interaction)
- **Objective:** Perform tasks on behalf of the user step-by-step.
- **Allowed Tools:** All Ask tools + `navigate`, `click`, `type`, `press_key`, `scroll`, `wait`, `switch_tab`, `new_tab`.
- **Gating Mechanism:** Sensitive actions (buy, pay, delete, publish, submit) require human confirmation before execution.

---

## 5. Functional Requirements

### 5.1 Element Perception & Grounding
- **Accessibility Snapshot (`read_page`):** Generates a compact tree of visible interactive elements with indexed handles (`[ref_N]`), ARIA roles, labels, input values, and bounding visibility.
- **Semantic Text Search (`find`):** Case-insensitive word query across DOM nodes, returning matching elements with `[ref_N]`.
- **Text Extraction (`get_page_text`):** Reads the main content (`main`, `article`, or `body`) up to 20,000 characters.
- **Visual Capture (`screenshot`):** Viewport screenshot downscaled to a maximum width of 1400px with 1:1 CSS pixel coordinate mapping for fallback clicks.

### 5.2 Browser Interaction & Input Simulation
- **Hybrid Input Pipeline:** Uses Chrome DevTools Protocol (`chrome.debugger`) for trusted, synthetic hardware mouse/keyboard events. Falls back to DOM-level dispatch if CDP cannot attach.
- **Visual Feedback:** Shows a temporary pulse animation (`flash`) at the clicked coordinate.
- **Automatic Scrolling:** Elements targeted by `ref_N` are brought to viewport center prior to clicking.

### 5.3 Safety & Guardrails
- **Credential Protection:** Hard block on typing into password inputs (`type="password"`, `autocomplete="*password*"`).
- **Restricted URL Enforcement:** Navigation to `javascript:`, `data:`, `file:`, `chrome:`, `edge:`, `about:`, and Web Store URLs is strictly blocked.
- **Indirect Prompt Injection Defense:** Web text is treated as untrusted data. Instructions contained inside page content are quarantined and ignored by the agent prompt.
- **Sensitive Action Card:** Actions triggering regex keywords (`buy`, `pay`, `delete`, `submit`, `publish`) pause the loop and present an Allow/Deny modal to the user.

### 5.4 LLM Provider Integrations
- **Anthropic:** Official Anthropic TypeScript SDK integration for Claude models.
- **OpenAI-Compatible (Fetch + SSE):** Native zero-dependency client with streaming support for:
  - Google Gemini (OpenAI endpoint)
  - Groq
  - OpenRouter
  - OmniRoute (local multi-provider router)
  - Ollama (local server)
  - Custom self-hosted endpoints (vLLM, LM Studio)

---

## 6. Non-Functional Requirements

- **Performance:** Stream start latency < 350ms (network-dependent). DOM snapshot generation < 60ms on typical pages.
- **Platform Compatibility:** Chromium browsers version 116+ (Chrome, Brave, Edge, Arc, Opera, Vivaldi).
- **Security:** Manifest V3 compliant, minimal service worker, no remote script execution, `storage.local` isolation.

---

## 7. Future Roadmap

- [ ] **Session & History Storage:** Persist past chat sessions and action logs in IndexedDB.
- [ ] **User Recipe Library:** Save custom reusable automation workflows (e.g., "Extract product prices to CSV").
- [ ] **Form Autofill Profile:** Safe user-approved profile for non-sensitive data (name, email, shipping address).
- [ ] **Tab Group Awareness:** Group and manage tabs opened by autonomous agents.
- [ ] **Dark / Light Theme Sync:** Match host browser system theme automatically.
