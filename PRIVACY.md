# Enki Browser Privacy Policy

**Version 4 · Effective 8 October 2026**

Enki Browser is an open-source web browser built on ungoogled-chromium, with the Enki AI
assistant, uBlock Origin Lite and Enki Shield built in. This policy describes what the browser
does with your data. Every claim here can be checked in the source code at
[github.com/danilogiles/enki-browser](https://github.com/danilogiles/enki-browser), the assistant
included (`extension/`).

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
| Nothing from voice input. The Whisper speech model itself (about 80 MB) is downloaded once | Hugging Face (`huggingface.co`) | The first time you press Enki's microphone | Your voice is turned into text on your computer and never sent anywhere; the download carries no audio. Microphone permission can be revoked in the browser's site settings |
| Update checks | GitHub (the browser's release page) | About every two hours while the browser is open, and when you click *Check for updates* (in Enki's Settings › About, the Shields popup, the Shields button's right-click menu or Shields' settings; on Windows). On macOS and Linux, only when you click it: one request for the latest release's number | Create a file named `no-update` next to `EnkiBrowser.exe` to turn updates off |
| Phishing and filter lists | GitLab / Cloudflare Pages (phishing list), the filter list hosts uBlock Origin Lite uses | Twice a day, and when uBlock refreshes its lists | The lists are downloaded whole; the sites you visit are never sent |

Websites you visit receive what any browser sends them, minus what Enki Browser blocks:
third-party cookies, known trackers and ads, and the local network address WebRTC would reveal.

## What stays on your device, and how it is protected

| Data | Where | Protection |
|---|---|---|
| Enki's API keys and connected apps' tokens | the browser's local extension storage | Encrypted (AES-256-GCM) with a key the browser keeps non-exportable; shown only masked |
| Enki's conversations, the list of chats and saved tasks | the same | Encrypted the same way |
| Shields' per-site choices and "forget this site" list | Enki Shield's local storage | Encrypted the same way |
| Saved passwords and cookies (your logins) | your profile folder | Encrypted by Chromium with a key protected by your account: by Windows (in the portable version too), by the login keychain on macOS, by the system keyring on Linux |
| Your voice, when you use Enki's microphone | memory, until it becomes text | Never written to disk or sent; the text lands in the message box for you to edit |
| What was blocked on each tab | memory, until the browser closes | Never written to disk |
| History, bookmarks, cache and the rest of the profile | your profile folder | Not encrypted by the browser — no mainstream browser does. Turn on your disk's encryption (Windows: Settings → Privacy & security → Device encryption, or BitLocker; macOS: FileVault, in System Settings → Privacy & Security) to protect them if someone gets your disk |

Whether Enki Browser is your default browser (Windows) is read from the registry on your computer,
only to decide whether to show the one-time *Make Enki Browser your default browser?* page and the
row in Shields' settings; the answer is not sent anywhere. Chromium's import dialog reads another
browser's data only when you open it and choose what to import, and starts with saved passwords
and autofill unticked.

Updates change only the program: your profile — history, bookmarks, logins, Enki's settings and
chats, Shields' choices — is kept exactly as it was, and an update restart reopens your windows
and tabs.

Nothing of this is synced or backed up by the project. Removing the browser and its profile
folder (`%LOCALAPPDATA%\EnkiBrowser` on Windows, `~/Library/Application Support/Enki Browser` on
macOS, `~/.config/enki-browser` on Linux) deletes it.

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
