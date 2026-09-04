# Privacy Policy for Enki Browser Extension

**Effective Date:** September 2026  
**Last Updated:** September 2026  
**Publisher:** DevOps Futurasync (Enki Open-Source Project)  
**Contact:** devops@futurasync.com / GitHub Issues  

---

## 1. Introduction
Enki ("we", "our", or "the Extension") is an open-source AI browser companion designed to let users interact with, analyze, and automate browser tasks using their own Large Language Model (LLM) API keys.

We believe privacy is a fundamental human right. Enki operates on a **Local-First & Bring-Your-Own-Key (BYOK)** architecture. We do **not** run centralized analytics, do **not** collect telemetry, do **not** sell user data, and do **not** operate any intermediary servers that store your browsing activity.

---

## 2. Information Handled by the Extension

### 2.1 API Keys and Settings
- **Storage:** All API keys (Anthropic, OpenAI, OmniRoute, or custom endpoints) and user settings (chosen provider, model, endpoint URL, theme, and behavior toggles) are stored exclusively in your browser's local sandbox via `chrome.storage.local`.
- **Transmission:** API keys are sent directly to your chosen AI provider over encrypted HTTPS connections. They are never sent to Futurasync or any third-party telemetry service.

### 2.2 Web Page Content & DOM Data
- **When Processed:** Enki only reads web page content (text, DOM structure, or screenshots) when you explicitly initiate an **Ask** or **Act** action.
- **Safety Filters:** Enki refuses to type into password and credential inputs (`type="password"`, or fields whose `autocomplete` marks them as a password or card security code), and requires your explicit confirmation before irreversible actions such as sending, purchasing, publishing or deleting.
- **What is sent:** Page context reaches the model as an accessibility outline of the visible page, its readable text, and (only when image support is enabled) a screenshot of the visible tab area. Enki does not read your browsing history, saved passwords, cookies, or autofill store.
- **Transmission:** The extracted page context is packaged into the prompt sent directly to your designated LLM provider. No page content is cached externally.

### 2.3 Browser Automation & Chrome DevTools Protocol (`debugger`)
- When running in **Act** mode, Enki uses the Chrome `debugger` API to dispatch synthetic user inputs (such as clicking buttons or typing into search bars) on your active tab.
- All actions are accompanied by a visible visual indicator on the screen notifying you that Enki is interacting with the page.
- Sessions can be stopped at any time via the "Stop" button or by closing the side panel.

---

## 3. Data Sharing and Third Parties
- **No Third-Party Brokers:** We do not sell, rent, or trade your data to data brokers, advertising networks, or analytics providers.
- **Direct-to-Provider Communication:** Your prompts, page excerpts, and API keys are transmitted solely to the LLM endpoint you select (e.g., Anthropic, OpenAI, or your self-hosted OmniRoute proxy). Please refer to your chosen provider's privacy policy for their handling of inference data.

---

## 4. User Control & Data Deletion
You maintain full control over your data at all times:
- You can clear chat history or reset API keys at any time via the Enki Settings tab.
- Removing the extension from Chrome (`chrome://extensions`) immediately and permanently deletes all stored keys, preferences, and cached session states from your computer.

---

## 5. Chrome Web Store Compliance
Enki complies strictly with the [Google Chrome Web Store Developer Program Policies](https://developer.chrome.com/docs/webstore/program-policies/), specifically:
- **Single Purpose:** Enki has a single, clearly defined purpose: assisting users with web page navigation, summarization, and task execution through their own LLMs.
- **Minimal Permissions:** All requested permissions (`debugger`, `tabs`, `activeTab`, `storage`, `webNavigation`, `sidePanel`, and `<all_urls>`) are strictly necessary to perform automated browser actions and extract DOM context on arbitrary user-requested websites.

---

## 6. Open Source Verification
Enki is 100% open-source. Anyone can audit the complete codebase, network calls, and security filters on GitHub:  
[https://github.com/devopsfuturasync/enkibrowser](https://github.com/devopsfuturasync/enkibrowser)

---

## 7. Changes to this Policy
If we update this Privacy Policy, the revised version will be committed to our public repository with an updated effective date.
