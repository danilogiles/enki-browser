# OmniRoute Setup Guide for Enki

This guide explains how to install **OmniRoute** from its official repository and configure it for **Enki Browser Assistant**.

---

## Step 1: Install OmniRoute from the Official Repository

OmniRoute is an open-source AI gateway that provides an OpenAI-compatible endpoint routing to 150+ free models automatically.

* **Official GitHub Repository:** [https://github.com/diegosouzapw/OmniRoute](https://github.com/diegosouzapw/OmniRoute)
* **Author:** Diego Souza ([@diegosouzapw](https://github.com/diegosouzapw))

### Official Installation Options:

#### Option A: Via npm CLI (Easiest)
```bash
npm install -g omniroute
omniroute
```

#### Option B: Clone Official Source
```bash
git clone https://github.com/diegosouzapw/OmniRoute.git
cd OmniRoute
npm install
npm start
```

Once running, OmniRoute will be accessible at `http://localhost:20128`.

---

## Step 2: Configure OmniRoute for Enki

To get optimal stability and avoid common upstream issues when using OmniRoute with Enki, apply the following configurations:

### 1. Docker Deployment with Playwright (Recommended for Docker Users)
The official Docker image (`diegosouzapw/omniroute:latest`) is minimal and lacks Playwright and Chromium binaries. When OmniRoute routes requests to providers that require headless browser sessions (such as Cloudflare Playground), it can fail with:
```text
[502]: Cloudflare Playground browser session failed: Playwright is not available.
```

To resolve this permanently, use the pre-configured `docker-compose.yml` and `docker/Dockerfile.omniroute` included in this repository:

```bash
docker compose up -d --build
```

This Dockerfile automatically builds on top of the official image and pre-installs:
- `playwright` npm package
- Headless Chromium and FFmpeg in `/ms-playwright`
- All necessary Linux OS dependencies (`install-deps`)
- Persistent volume storage (`omniroute-data`)

### 2. Configure Enki Settings
1. Open the **Enki** side panel in your Chromium browser (`Ctrl+Shift+E` or `Cmd+Shift+E`).
2. Click the **Settings ⚙️** icon in the top right.
3. Select **OmniRoute (free models, local gateway)** in the Provider list.
4. Set **Base URL** to `http://localhost:20128/v1`.
5. Set **Model** to:
   - `auto` (default auto-routing)
   - `openrouter/auto` or `tr/auto` (direct API routes without browser dependencies)
6. Click the **Refresh 🔄** button to test the connection.
7. Click **Save**.

### 3. Dashboard Customization (Optional)
Visit `http://localhost:20128` in your browser to:
- View real-time request logs and token metrics.
- Add personal paid keys (OpenAI, Anthropic, Gemini, Groq) to route alongside free models.
- Disable specific providers if desired.
