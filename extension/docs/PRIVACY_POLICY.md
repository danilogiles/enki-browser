# Privacy Policy for Enki Browser Extension

**Effective Date:** September 2026  
**Last Updated:** 7 October 2026  
**Publisher:** Enki contributors (open-source project)  
**Contact:** [GitHub Issues](https://github.com/danilogiles/enkibrowser/issues); security problems through [private vulnerability reporting](https://github.com/danilogiles/enkibrowser/security/advisories/new)  

---

## 1. Introduction
Enki ("we", "our", or "the Extension") is an open-source AI browser companion designed to let users interact with, analyze, and automate browser tasks using their own Large Language Model (LLM) API keys.

We believe privacy is a fundamental human right. Enki operates on a **Local-First & Bring-Your-Own-Key (BYOK)** architecture. We do **not** run centralized analytics, do **not** collect telemetry, do **not** sell user data, and do **not** operate any intermediary servers that store your browsing activity.

---

## 2. Information Handled by the Extension

### 2.1 API Keys and Settings
- **Storage:** All API keys (Anthropic, OpenAI, OmniRoute, or custom endpoints) and user settings (chosen provider, model, endpoint URL, theme, and behavior toggles) are stored exclusively in your browser's local sandbox via `chrome.storage.local`.
- **Encryption:** API keys, each kept separately for its provider, and connected apps' access tokens are encrypted (AES-256-GCM) before they are stored. The encryption key is created by the browser as non-exportable and kept in Enki's own storage, so keys never sit in plain text in your profile. Saved keys are shown only masked (for example `nvapi-••••••a1b2`); to change one you replace it.
- **Transmission:** API keys are sent directly to your chosen AI provider over encrypted HTTPS connections. They are never sent to the Enki project or any third-party telemetry service.

### 2.2 Web Page Content & DOM Data
- **When Processed:** Enki only reads web page content (text, DOM structure, or screenshots) when you explicitly initiate an **Ask** or **Act** action.
- **Safety Filters:** Enki refuses to type into password and credential inputs (`type="password"`, or fields whose `autocomplete` marks them as a password or card security code), and requires your explicit confirmation before irreversible actions such as sending, purchasing, publishing or deleting.
- **What is sent:** Page context reaches the model as an accessibility outline of the visible page, its readable text, and (only when image support is enabled) a screenshot of the visible tab area. Enki does not read your browsing history, saved passwords, cookies, or autofill store.
- **Transmission:** The extracted page context is packaged into the prompt sent directly to your designated LLM provider. No page content is cached externally.

### 2.3 Browser Automation & Chrome DevTools Protocol (`debugger`)
- When running in **Act** mode, Enki uses the Chrome `debugger` API to dispatch synthetic user inputs (such as clicking buttons or typing into search bars) on your active tab.
- All actions are accompanied by a visible visual indicator on the screen notifying you that Enki is interacting with the page.
- Sessions can be stopped at any time via the "Stop" button or by closing the side panel.

### 2.4 Web Search and Reading Sources
- To answer questions about current events, Enki can search the web (`web_search`) and read pages (`read_url`) without leaving your tab.
- **What is sent:** only the search words, to Brave Search and, if it does not answer, DuckDuckGo; and an ordinary request to each page Enki reads. These requests carry no cookies.
- Pages that need JavaScript are opened briefly in a background tab of your browser, read, and closed.

### 2.5 Connected Apps (MCP)
- In Settings → Connections you can connect apps such as Jira, Linear, Notion, Sentry or GitHub through their MCP servers.
- You sign in on the app's own page; Enki keeps only the access token the app grants, in `chrome.storage.local`, and sends it only to that app.
- Enki uses a connected app only for your requests. Tools that change data ask for your confirmation unless you allow that specific tool. Disconnecting deletes the token.

### 2.6 Conversations
- With "Save conversations on this device" on (the default), your chats are kept in `chrome.storage.local` so you can reopen them, **encrypted (AES-256-GCM)** like your keys, list of chats and saved tasks included; screenshots and model reasoning are not saved. Turning the setting off deletes every saved chat.


### 2.7 Voice Input
- The microphone button turns speech into text **on your computer**, with OpenAI's Whisper model running inside the browser. The recording is never sent anywhere — not to your AI provider, not to the Enki project — and is discarded once it becomes text, which you can edit before sending.
- The first time you use it, the model (about 80 MB) is downloaded once from Hugging Face (`huggingface.co`) and kept in the browser's cache; that request carries no audio and nothing about you. The program that runs it ships inside the extension.
- The browser asks your permission for the microphone once; you can revoke it in the browser's site settings.

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
[https://github.com/danilogiles/enkibrowser](https://github.com/danilogiles/enkibrowser)

---

## 7. Changes to this Policy
If we update this Privacy Policy, the revised version will be committed to our public repository with an updated effective date.
