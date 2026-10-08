# Set up your AI assistant (Enki 0.8.3)

A few minutes, once. Tick each box as you go.

## Steps

- [ ] **1. Install and open Enki.** Install Enki Browser and open it like any other browser. On Windows or Mac, the first launch may show a security warning — see [Good to know](#good-to-know).
- [ ] **2. Open the Enki panel.** Click **Open Enki** in the toolbar, or press **Ctrl+Shift+E** on Windows/Linux (**Cmd+Shift+E** on Mac). A side panel opens. If the shortcut doesn't open the panel, set it in `chrome://extensions/shortcuts`.
- [ ] **3. Go to Settings › Model and pick a Provider.** In the panel, open **Settings › Model**. Under **Provider**, the default is **NVIDIA (Nemotron) · free** — a good place to start.
- [ ] **4. Add your API key.** Nemotron is free but still needs a key. Click **Get a key** ([build.nvidia.com](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b), no credit card), copy your `nvapi-…` key and paste it into **API key**. Then click **Run connection diagnostics**.
  - Without a key, Enki shows “Add an API key in Settings to start.”
  - Prefer no key at all? Choose **Ollama (local)** at `http://localhost:11434/v1`.
  - **Ollama (local):**
    1. Install Ollama from [ollama.com](https://ollama.com).
    2. **Windows:** in Command Prompt run `setx OLLAMA_ORIGINS "chrome-extension://caelfocbikejgdamghjlkpmbbaobehlp"`, then quit Ollama from the tray and open it again.
    3. **Mac/Linux:** start Ollama with `OLLAMA_ORIGINS=chrome-extension://caelfocbikejgdamghjlkpmbbaobehlp` (for example `OLLAMA_ORIGINS=chrome-extension://caelfocbikejgdamghjlkpmbbaobehlp ollama serve`).
    4. `ollama pull qwen3-vl` (vision + tools; better fit than a plain chat-only model).
    5. In Enki: **Settings › Model** → **Provider** → **Ollama (local)**.
  - Loaded the extension from source? Use the ID shown in `chrome://extensions` instead.
- [ ] **5. Try Ask on a page.** Open any web page, click the **Ask** icon and type a question, e.g. “Summarize this page.” Tooltip: “Ask: Enki reads the page and answers”.
- [ ] **6. Optional: Act, with care.** Click the **Act** icon — “Act: Enki can navigate, click and type”. It asks you to confirm sensitive actions first. **Never paste passwords into the chat.**

## Other providers

Enki is **Bring Your Own Model**. In **Settings › Model**, under **Provider**, you can also choose:

- **Anthropic (Claude)**, **OpenAI**, **Google Gemini**, **Groq** — each needs its own API key
- **OpenRouter**, including `openrouter/free` — needs an OpenRouter key
- **Ollama (local)** — runs on your computer, no key: `http://localhost:11434/v1` (requires `OLLAMA_ORIGINS=chrome-extension://caelfocbikejgdamghjlkpmbbaobehlp` and a restart of Ollama; see step 4)
- **Custom (OpenAI-compatible)** — any OpenAI-compatible endpoint

After any change, click **Run connection diagnostics**.

## Your privacy

- Your API keys stay **local** on your device.
- No Enki account needed.
- No telemetry.
- In **Ask**, page text can go to the provider you chose. In **Act**, page text **and screenshots** can go to that same provider — only when you use the assistant.
- With **Ollama (local)**, it never leaves your computer.

## Ask vs Act

| Mode | What it does |
|------|--------------|
| **Ask** | “Ask: Enki reads the page and answers” |
| **Act** | “Act: Enki can navigate, click and type” — sensitive actions only after you confirm |

> **Never paste passwords into the chat.**

## Good to know

- **Windows:** the first install may show a SmartScreen warning. The publisher is **Danilo De Souza**.
- **Mac:** releases are not notarized yet, so Gatekeeper may block the first launch. Choose **Open Anyway** once (System Settings › Privacy & Security); after that Enki opens normally.
- **Streaming:** DRM-protected services (like Netflix or Crunchyroll) are not supported yet.
- Open source: [github.com/danilogiles/enki-browser](https://github.com/danilogiles/enki-browser)
