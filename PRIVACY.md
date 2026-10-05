# Enki Browser Privacy Policy

**Version 1 · Effective 4 October 2026**

Enki Browser is an open-source web browser built on ungoogled-chromium, with the Enki AI
assistant, uBlock Origin Lite and Enki Shield built in. This policy describes what the browser
does with your data. Every claim here can be checked in the source code at
[github.com/danilogiles/enki-browser](https://github.com/danilogiles/enki-browser) and
[github.com/danilogiles/enkibrowser](https://github.com/danilogiles/enkibrowser).

## The short version

- **We do not collect your data.** The Enki Browser project runs no servers that receive your
  browsing, your conversations with Enki, or any telemetry. There are no accounts.
- **What you browse stays on your device**, except for the requests listed below, each of which
  you can see in the code and most of which you control.
- **We do not sell, rent or share data**, because we do not have it.

## What leaves your device, and why

| What | Sent to | When | Your control |
|---|---|---|---|
| Your message to Enki, the page context Enki reads (page text, an outline of the page, and a screenshot only if image support is on), and Enki's earlier messages in that chat | The AI provider **you** choose in Enki's Settings (for example NVIDIA, Anthropic, OpenAI, Google, OpenRouter, a local Ollama or OmniRoute) | Only when you send a message, run a saved task, or search from the address bar with Enki | Pick the provider, use a local model, or don't use Enki. That provider's own privacy policy governs what it does with the request |
| Web searches Enki makes to answer you | Brave Search, then DuckDuckGo if Brave does not answer | When Enki decides a question needs current information | Only the search words are sent, without cookies |
| Pages Enki reads for you (`read_url`) | The website itself | When Enki reads a source | Like opening the page yourself, without your cookies for that request |
| Requests to apps you connect (Jira, Linear, Notion, Sentry, GitHub, or other MCP servers) | That app | Only after you connect it in Settings → Connections, and only when Enki uses it for your request | Disconnect any app at any time; changes in an app wait for your confirmation unless you allow that tool |
| Your address bar typing, for suggestions | DuckDuckGo's suggestion service | While you type in the address bar | Change or turn off suggestions in the browser's settings |
| Update checks | GitHub (the browser's release page) | About every two hours while the browser is open | Create a file named `no-update` next to `EnkiBrowser.exe` to turn updates off |
| Phishing and filter lists | GitLab / Cloudflare Pages (phishing list), the filter list hosts uBlock Origin Lite uses | Twice a day, and when uBlock refreshes its lists | The lists are downloaded whole; the sites you visit are never sent |

Websites you visit receive what any browser sends them, minus what Enki Browser blocks:
third-party cookies, known trackers and ads, and the local network address WebRTC would reveal.

## What stays on your device

- Enki's settings, including your API keys, and your saved chats (if "Save conversations" is
  on), in the browser's local extension storage.
- Access tokens for connected apps, in the same local storage.
- Enki Shields' per-site choices and the count of what was blocked on each tab (the count is
  kept only until the browser closes).
- Your browsing history, cookies, passwords and everything else a browser keeps, in your profile
  folder, managed by Chromium as in any browser.

Nothing of this is synced or backed up by the project. Removing the browser and its profile
folder (`%LOCALAPPDATA%\EnkiBrowser` on Windows, `~/.config/enki-browser` on Linux) deletes it.

## Google services

ungoogled-chromium removes Google's background services: no sign-in, sync, Safe Browsing
lookups, crash reports, usage statistics or field trials are sent to Google. If you choose
Google as a search engine or Gemini as Enki's provider, those requests go to Google like any
site you use.

## Children

Enki Browser is not directed at children under 13 and collects no personal information from
anyone.

## Changes

Changes to this policy are made in the public repository, where their history is visible, with a
new version number and date.

## Contact

Open an issue at [github.com/danilogiles/enki-browser/issues](https://github.com/danilogiles/enki-browser/issues).
Report security problems as described in the repository's security policy.
