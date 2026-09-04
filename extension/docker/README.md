# Running OmniRoute with Docker (Enki Companion)

This guide explains how to run **OmniRoute** in Docker with full **Playwright & Chromium** support to power the Enki Browser Assistant with free or self-hosted AI models.

---

## 1. Quick Start

Run the following command from the repository root:

```bash
docker compose up -d --build
```

This will:
1. Build the custom OmniRoute image containing Playwright, Chromium, and all Linux system dependencies.
2. Launch the gateway container mapped to `http://localhost:20128`.
3. Persist keys, models, and cache in the `omniroute-data` Docker volume.

To view logs:
```bash
docker compose logs -f
```

To stop the container:
```bash
docker compose down
```

---

## 2. Connecting Enki to OmniRoute

1. Open **Enki** in your Chromium browser (press `Ctrl+Shift+E` or `Cmd+Shift+E`).
2. Click the **Settings ⚙️** icon in the top right.
3. Under **Provider**, select **OmniRoute (free models, local gateway)**.
4. Keep the **Base URL** as `http://localhost:20128/v1`.
5. Under **Model**, keep `auto` (or pick `openrouter/auto`, `tr/auto`).
6. Click the **Refresh 🔄** button to verify the connection.
7. Click **Save**.

---

## 3. Why This Custom Image Is Needed

The official default `diegosouzapw/omniroute` Docker image is minimal and lacks Playwright/Chromium binaries. When OmniRoute routes requests to providers that require browser sessions (like Cloudflare Playground or scraping-based endpoints), it fails with:

```text
[502]: Cloudflare Playground browser session failed: Playwright is not available.
```

The included `docker/Dockerfile.omniroute` solves this permanently by pre-installing:
- `playwright` npm package
- Headless Chromium and FFmpeg binaries in `/ms-playwright`
- All required Linux graphics/audio libraries (`install-deps`)

Even if you restart your machine or recreate the container, your setup will remain stable.
