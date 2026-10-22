# Enki Browser Privacy Policy

**Version 5 · Effective 9 October 2026**

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
| Your message to Enki, the page context Enki reads (page text, an outline of the page, and a screenshot only if image support is on: with every message only if you turn on *Attach a screenshot to every message*, which is off by default since Enki Browser 0.8.11, otherwise only when Enki takes one to see the page), and Enki's earlier messages in that chat | The AI provider **you** choose in Enki's Settings (for example NVIDIA, Anthropic, OpenAI, Google, OpenRouter, a local Ollama or OmniRoute) | Only when you send a message, run a saved task, or search from the address bar with Enki | Pick the provider, use a local model, or don't use Enki. That provider's own privacy policy governs what it does with the request |
| What you type in the address bar, when you chose **Ask Enki** as the search engine (or start with `@enki`) | The AI provider **you** chose in Enki's Settings, and nothing else: no open tab, page content, history or Enki chats go with it. If the provider uses its own web search, the query may be passed to its search partner, and the answer page says so | Only after you press Enter; nothing is sent while you type. The answer page is part of Enki on your computer (`search.html`) and never goes through a server of ours. Answers are not saved as Enki chats; the query is in browser history like any search | Choose *Search engine: Enki AI \| DuckDuckGo* in Enki's Settings (or Shields' settings), or start a search with `@ddg`. Until you choose, with no model set up, after an auth or rate-limit error, and in incognito, searches go to DuckDuckGo with only the query (`q`) |
| Web searches Enki makes to answer you | Brave Search, then DuckDuckGo if Brave does not answer | When Enki decides a question needs current information | Only the search words are sent, without cookies |
| Pages Enki reads for you (`read_url`) | The website itself | When Enki reads a source | Like opening the page yourself, without your cookies for that request |
| Requests to apps you connect (Jira, Linear, Notion, Sentry, GitHub, or other MCP servers) | That app | Only after you connect it in Settings → Connections, and only when Enki uses it for your request | Disconnect any app at any time; changes in an app wait for your confirmation unless you allow that tool |
| Your address bar search | DuckDuckGo, the default search engine | Only when you press Enter; suggestions while typing are off by default | Choose another engine, or turn suggestions on, in the browser's settings |
| Nothing from voice input. The Whisper speech model itself (about 80 MB) is downloaded once | Hugging Face (`huggingface.co`) | The first time you press Enki's microphone | Your voice is turned into text on your computer and never sent anywhere; the download carries no audio. Microphone permission can be revoked in the browser's site settings |
| Update checks | GitHub (the browser's release page) | About every two hours while the browser is open, and when you click *Check for updates* (in Enki's Settings › About, the Shields popup, the Shields button's right-click menu or Shields' settings; on Windows). On macOS and Linux, only when you click it: one request for the latest release's number | Create a file named `no-update` next to `EnkiBrowser.exe` to turn updates off |
| Protected video (Widevine), only if you turn it on (Windows) | Google (`update.googleapis.com` and Google's download servers) | When you click *Download from Google* in Shields' settings, then about once a day to keep it current. The request names the module, your Windows version and Enki Browser's Chromium version; no cookies, nothing about you or the sites you visit | *Turn off* in Shields' settings removes the module and stops the requests. Google's terms apply to the module |
| Global Privacy Control: the `Sec-GPC: 1` header and `navigator.globalPrivacyControl` | Every website you visit | On every request, also on sites where Shields are down | It says only that you do not want your data sold or shared, nothing about you. Turn it off in Shields' settings (*Tell sites not to sell or share my data*) |
| Phishing and filter lists | GitLab / Cloudflare Pages (phishing list), the filter list hosts uBlock Origin Lite uses | Twice a day, and when uBlock refreshes its lists | The lists are downloaded whole; the sites you visit are never sent |

### Hosts Enki Browser contacts on its own

The list below is the same information as the table above, as host names, so that a test can
check it: `test/network-hosts.mjs` starts a built Enki Browser with a new profile, without the
internet, and fails if the browser tries to reach any host that is not listed here (or if this
list cannot be read). *background* means the browser may contact the host without you doing
anything; *user* means only after an action of yours (a search from the address bar, a button
in Settings, a question to Enki). Not listed, because you choose them: the websites you open, the
AI provider you set up in Enki's Settings and the apps you connect to Enki.

<!-- enki-allowed-hosts:begin -->
```text
# host                     when        why (see the table above)
api.github.com             background  update check: about every two hours on Windows; on click on macOS and Linux
github.com                 background  update download on Windows; the release page when you click Download
malware-filter.gitlab.io   background  phishing list, twice a day
malware-filter.pages.dev   background  phishing list (second address of the same list)
duckduckgo.com             user        address-bar search, when you press Enter
html.duckduckgo.com        user        web search Enki makes to answer you (if Brave Search does not answer)
search.brave.com           user        web search Enki makes to answer you
huggingface.co             user        the Whisper speech model, once, the first time you press Enki's microphone
update.googleapis.com      user        protected video (Widevine), only after Download from Google (Windows)
```
<!-- enki-allowed-hosts:end -->

Websites you visit receive what any browser sends them, minus what Enki Browser blocks:
third-party cookies, known trackers and ads, the local network address WebRTC would reveal, and
tracking parameters such as `utm_source` or `fbclid` in the addresses of pages you open (not on
sites where you turn Shields down; a site turned down from an Incognito window is kept in memory
only, never written to storage).

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

## Built-in components

Enki Browser ships three extensions. Each one is listed on `chrome://extensions` like any other
extension, with its permissions; none is hidden. This table is checked against the shipped
manifests by `test/components.mjs`, so it cannot drift from what the browser actually loads.

| Component | What it does | Permissions | Sites it can access |
|---|---|---|---|
| Enki | The AI assistant: side panel, Enki Home and AI search | `sidePanel`, `activeTab`, `tabs`, `scripting`, `storage`, `debugger`, `webNavigation` | All sites, so it can read and act on the page you ask about. `debugger` is how Act clicks and types; Chromium shows its warning bar while it is in use |
| Enki Shield | Shields: per-site switches, phishing warnings, tracking-parameter removal, Global Privacy Control, the address bar search rule and Check for updates | `declarativeNetRequest`, `webNavigation`, `webRequest`, `tabs`, `storage`, `alarms`, `contentSettings`, `browsingData`, `nativeMessaging`, `contextMenus`, `scripting` | All sites, to apply Shields on every page |
| uBlock Origin Lite | Ad and tracker blocking, unmodified except for a small patch that lets Shields read and set a site's filtering mode | `activeTab`, `alarms`, `declarativeNetRequest`, `offscreen`, `scripting`, `storage`, `unlimitedStorage`, `userScripts` | All sites, to block ads and trackers |

On Windows, Enki Shield is the only extension allowed to talk to the Enki Browser launcher (its
native messaging host), and only for what the table above lists under Update checks, default
browser status and protected video.

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
