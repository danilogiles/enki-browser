# Set up your AI assistant (Enki 0.8.3)

A few minutes, once. Tick each box as you go.

## Steps

- [ ] **1. Install and open Enki.** Install Enki Browser and open it like any other browser. On Windows or Mac, the first launch may show a security warning — see [Good to know](#good-to-know).
- [ ] **2. Open the Enki panel.** Click **Open Enki** in the toolbar, or press **Ctrl+Shift+E** on Windows/Linux (**Cmd+Shift+E** on Mac). A side panel opens.
- [ ] **3. Go to Settings › Model and pick a Provider.** In the panel, open **Settings › Model**. Under **Provider**, the default is **NVIDIA (Nemotron) · free** — a good place to start.
- [ ] **4. Add your API key.** Nemotron is free but still needs a key. Click **Get a key** ([build.nvidia.com](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b), no credit card), copy your `nvapi-…` key and paste it into **API key**. Then click **Run connection diagnostics**.
  - Without a key, Enki shows “Add an API key in Settings to start.”
  - Prefer no key at all? Choose **Ollama (local)** at `http://localhost:11434/v1`.
  - **Windows + Ollama:** before Enki can talk to Ollama, set the origin once, then restart Ollama:
    1. In Command Prompt: `setx OLLAMA_ORIGINS "chrome-extension://*"`
    2. Quit Ollama from the tray icon and open it again (so it picks up the variable).
    3. `ollama pull qwen3-vl` (vision + tools; better fit than a plain chat-only model).
    4. In Enki: **Settings › Model** → **Provider** → **Ollama (local)**.
- [ ] **5. Try Ask on a page.** Open any web page, choose **Ask** and type a question, e.g. “Summarize this page.” Tooltip: “Ask: Enki reads the page and answers”.
- [ ] **6. Optional: Act, with care.** **Act** — “Act: Enki can navigate, click and type”. It asks you to confirm sensitive actions first. **Never paste passwords into the chat.**

## Other providers

Enki is **Bring Your Own Model**. In **Settings › Model**, under **Provider**, you can also choose:

- Claude, GPT, Gemini, Groq — each needs its own API key
- OpenRouter, including `openrouter/free` — needs an OpenRouter key
- **Ollama (local)** — runs on your computer, no key: `http://localhost:11434/v1` (requires `OLLAMA_ORIGINS=chrome-extension://*` and a restart of Ollama; see step 4)
- Any OpenAI-compatible endpoint

After any change, click **Run connection diagnostics**.

## Your privacy

- Your API keys stay **local** on your device.
- No Enki account needed.
- No telemetry.
- In **Ask**, page text can go to the provider you chose. In **Act**, page text **and screenshots** can go to that same provider — only when you use the assistant.

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
