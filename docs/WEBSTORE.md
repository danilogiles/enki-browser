# Install in Enki (Chrome Web Store)

Enki Browser is built on ungoogled-chromium, which has no Web Store installs: the store's own
"Add to Chrome" button does nothing. Enki Shield 1.2.9 adds an **Install in Enki** button to
`https://chromewebstore.google.com/detail/…` pages. Design and words: Ink
(`enki-brand/0.8.13-webstore`, mocks 01–05; mock 06 was not built: Helm accepted the leftover .crx, see *The .crx in Downloads*).

## How it works

1. `shield/webstore-page.js` (content script, top frame of store pages only) draws the button in
   a **closed** shadow root. Only real clicks count (`event.isTrusted`), so the page cannot press it.
2. A click opens Ink's access note (mock 02), the same for every extension: Shield never opens a
   .crx itself, so there is no download before Continue and no permission list of its own.
   Chromium's prompt shows the extension's permissions next. Focus starts on **Cancel**; Enter
   there or Escape closes the note.
3. **Continue** sends `enki-shield:cws-install` to the worker (`shield/webstore.js`) with the id
   in the tab's address at that moment, which must still be the id the card was drawn for. The
   worker reads the id from the address of the store page the message came from (`sender.url`, as
   Chromium reports it: top frame, Shield's own content script); it must match `^[a-p]{32}$`
   **and** equal the id sent (`installId` in `shield/webstore-core.js`), or nothing is opened and
   the card says it could not tell which extension this is. The sent id is only a cross-check: it
   cannot choose another extension, and nothing in the message chooses the address.
4. The worker builds the address (`shield/webstore-core.js`, `crxUrl`) and opens it in that tab:

   `https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&prodversion=<browser version>&x=id%3D<id>%26installsource%3Dondemand%26uc`

   `prodversion` is the running browser's full version (`navigator.userAgentData`), so Google
   picks a build that runs on it.
5. Google answers with a redirect to `clients2.googleusercontent.com/crx/blobs/…/<ID>_<version>.crx`.
   Enki starts Chromium with `--extension-mime-request-handling=always-prompt-for-install`
   (`config/flags.txt`, read by the Windows, Linux and macOS launchers), so Chromium hands the
   download to its own installer: CRX3 signature check, then its own **Add "…"?** prompt. Nothing
   is installed until the user clicks **Add extension**.

No new permission: `management`, `downloads` and host permissions for Google are not added.

## Privacy

- Google is contacted only after Continue, and by the optional update check.
- `shield/rules/webstore.json` (one rule, its own ruleset `webstore`) removes `Cookie`, `Referer`
  and `X-Client-Data` from requests to **clients2.google.com and clients2.googleusercontent.com
  only**, and `Set-Cookie` from their answers. A store visit leaves Google cookies (NID, …) for
  `.google.com`; they do not ride along. Other Google hosts are untouched (the e2e test checks
  both sides).
- Shield's own fetches use `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `cache: "no-store"`.
- PRIVACY.md lists both hosts (table rows and allowed hosts).

## Shield's record, and its drift

Without `management` Shield cannot see what is installed. It keeps its own record of installs
made with the button, `shields:cws-installed` = `{ id: { name, version, installedAt } }`. The
version comes from the file name of Google's redirect (`webRequest.onBeforeRedirect`), as the
download starts.

The record drifts:
- an install cancelled at Chromium's prompt is still recorded;
- an extension removed in chrome://extensions stays recorded;
- an extension updated by other means keeps its old version.

With update checks on, a drifted entry's id and version are still sent to Google. **Forget** in
Shields' settings (mock 04) removes an entry. If no version is known, the first update check
records the current one as a baseline instead of offering an update.

## Update checks (optional, off by default)

- Shields' settings, "Check for updates to store extensions". Off by default.
- The 24-hour alarm `shield-cws-updates` exists only while the switch is on: switching on creates
  it and checks right away, switching off removes it. A run missed while the browser was closed
  fires on the next start (alarms persist).
- One GET to `clients2.google.com/service/update2/crx` with exactly `acceptformat=crx3`,
  `prodversion=<browser version>` and one `x=id%3D<id>%26v%3D<version>%26uc` per recorded
  extension. Nothing else: no os, arch, channel, language or install source. Checked live
  against Google's server: this minimal set is answered (gupdate XML); unknown ids come back as
  `status="error-unknownApplication"` and are ignored.
- A newer version shows Ink's notice (mock 05) in the Shields panel and in settings: **Later**
  hides it for that version, **Update** opens the same .crx address as the button, so Chromium's
  prompt asks again.
- Settings say what is sent: ids, versions and the browser version, no cookies, no Google account.

## The .crx in Downloads: accepted and documented (Helm's decision)

Chromium saves the .crx to the Downloads folder before its prompt. After **Add extension** it
removes it; after **Cancel** it stays (`<ID>_<version>.crx`). Removing it would need the
`downloads` permission, which Shield does not have and does not add.

**Helm decided: the leftover .crx is accepted and documented.** It is not cleaned up, Shield asks
for no `downloads` permission, and Ink's mock 06 (the cleanup) is not built. Users can delete the
file like any other download. The e2e test asserts both outcomes (removed after Add, left after
Cancel), so a change in Chromium's behaviour shows up.

## The update switch's target

The update switch in Shields' settings is drawn 38x22 like Shield's other switches, but answers
clicks and taps in a 44x44 area around it (a transparent `::before` in `shield/popup.css`); the
2px focus ring stays on the switch. The unit test checks the CSS, the e2e test measures the
target in the browser and turns the switch on with a click in that area's corner.

## Words

`scripts/webstore-strings.mjs` merges Ink's `strings.json` into `shield/_locales` (en, pt_BR, es,
es_419; es_419 carries only Ink's keys, Chromium falls back to es for the rest). Every entry's
description says it is a placeholder pending Danilo's approval; changing a word is a strings.json
edit and a re-run of the script. Placeholders are numbered in the order name, version, from, to.

## Tests, and which CI job runs them (no workflow changed)

| Test | What | Runs in CI |
|---|---|---|
| `test/shield-webstore-unit.mjs` | id rules, store addresses, Continue's id cross-check (sent id must equal the address's), the update switch's 44x44 target, exact query of both Google addresses (and the forbidden params), update reply parsing, version from file name, rule scope, manifest permissions unchanged, locales | called by `test/verify.mjs`: **Windows** (`npm run verify`), **Linux** (verify step after the .tar.gz install), **macOS** (verify step) |
| `test/verify.mjs` (new checks) | the shipped Shield has the button and rule; chrome://version shows the always-prompt switch | the same three jobs |
| `test/shield-webstore.mjs` | end to end in the built browser: closed shadow root, untrusted clicks ignored, access note focus/Enter/Escape, Cancel at Chromium's prompt (leftover .crx), Add (installed in the profile), no Cookie/Referer/X-Client-Data on either clients2 host with a google.com cookie in the jar (and a control host that gets it), Set-Cookie not kept, record and version, update switch 38x22 with a 44x44 target and 2px focus ring, switch/alarm/exact query/notice/Update/off, Forget | called by `test/verify.mjs` on **Linux only** (needs xvfb and xdotool, which the Linux job installs); `ENKI_SKIP_WEBSTORE_E2E=1` skips it |

```
node test/shield-webstore-unit.mjs
node build/build-linux.mjs && xvfb-run -a node test/shield-webstore.mjs
ENKI_WEBSTORE_ONLINE=1 xvfb-run -a node test/shield-webstore.mjs   # the real store and Google (opt-in)
```

The online mode installs a real extension (`ENKI_WEBSTORE_ID`, default Claude,
`fcoeoabgfenejglbffodgkkbkcdhcgfn`) into a throwaway profile and reads the headers Chromium sent
from DevTools. DevTools does not always report the redirected hop that becomes the download; the
offline run, where a local server sees every request, is the one that must cover both hosts.

## Not covered by CI: Windows and macOS by hand

CI on Windows and macOS runs the unit checks and the switch check, not the click-through: the
native prompt has to be answered by a person. Before release, on Windows (Danilo's PC) and on a Mac:

1. Install the build from the draft PR's artifacts (or `npm run build` on Windows) and start
   Enki Browser normally.
2. Open https://chromewebstore.google.com/detail/fcoeoabgfenejglbffodgkkbkcdhcgfn (or any small
   extension). The **Install in Enki** card is at the top right.
3. Press F12 on that tab, Network tab, tick **Preserve log**.
4. Click **Install in Enki**. The access note opens, focus is on **Cancel** (press Enter: it
   closes). Click again, press Escape: it closes. Nothing appears in Network.
5. Click **Install in Enki**, then **Continue**. Chromium asks *Add "…"?*. Click **Cancel**.
   Expected: nothing installed; `%USERPROFILE%\Downloads\<ID>_<version>.crx` (macOS:
   `~/Downloads`) is left (the documented leftover). Delete it.
6. Again, **Continue**, then **Add extension**. Expected: the extension is in chrome://extensions,
   and no .crx is left in Downloads.
7. In Network, click the `crx?response=redirect…` request and the `….crx` request on
   clients2.googleusercontent.com: under Request Headers there is **no Cookie, Referer or
   X-Client-Data**. (chrome://settings/cookies → See all site data → google.com shows the NID
   cookie the store set, so there was one to send.)
8. Shields settings (right-click the Shields button → Options): **Store extensions** lists it
   with its version. Switch **Check for updates** on. chrome://extensions → Enki Shield →
   *service worker* → Network: one `update2/crx?acceptformat=crx3&prodversion=…&x=id%3D…%26v%3D…%26uc`
   request, no Cookie. Switch it off.
9. **Forget**: the entry disappears.
10. Screen reader (NVDA / VoiceOver): the note is announced as an alert dialog with its title and
    list; the settings switch is announced as a switch with its description.
