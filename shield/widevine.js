// Protected video (Widevine), in Enki Shields' settings.
//
// Streaming sites such as Crunchyroll need Widevine, Google's closed-source module, to play.
// Enki Browser does not ship it; on Windows the launcher downloads it from Google when the user
// turns it on here, after saying what it is (launcher/Widevine.cs, through launcher/NativeHost.cs),
// and keeps it current. Nothing is downloaded before the click on "Download from Google". macOS
// and Linux have no launcher to ask yet; they get the row with that said.

import { t } from "./i18n.js";

/** Shows the row and wires its buttons. `native` asks the launcher; `restart` restarts the browser. */
export async function showWidevine($, native, restart) {
  const state = $("widevine-state");
  const on = $("widevine-on"), off = $("widevine-off"), again = $("widevine-restart");
  const consent = $("widevine-consent"), go = $("widevine-go"), cancel = $("widevine-cancel");

  const render = (s, note) => {
    on.hidden = off.hidden = again.hidden = true;
    consent.hidden = true;
    if (!s) {
      state.textContent = t("w_otherOs");
      return;
    }
    if (s.error) state.textContent = t("w_error", s.error);
    else if (s.restartNeeded && s.installed) {
      state.textContent = t("w_ready", s.installed);
      again.hidden = false;
    } else if (s.installed && s.managed) state.textContent = t("w_on", s.installed);
    else if (s.installed) state.textContent = t("w_byHand", s.installed);
    else state.textContent = note ?? t("w_off");
    on.hidden = !!(s.installed && s.managed);
    on.textContent = t(s.installed && !s.managed ? "w_keepUpdated" : "o_turnOn");
    off.hidden = !s.installed;
  };

  const current = await native({ type: "widevine-status" });
  // An older launcher answers anything it does not know with its update status: no "installed" key.
  const known = (s) => (s && ("installed" in s || s.error) ? s : null);
  render(known(current));

  on.onclick = () => { consent.hidden = false; cancel.focus(); };
  cancel.onclick = () => { consent.hidden = true; on.focus(); };
  go.onclick = async () => {
    go.disabled = cancel.disabled = true;
    consent.hidden = true;
    state.textContent = t("w_downloading");
    try { render(known(await native({ type: "widevine-install" }))); } finally { go.disabled = cancel.disabled = false; }
  };
  off.onclick = async () => {
    off.disabled = true;
    try { render(known(await native({ type: "widevine-remove" })), t("w_removed")); } finally { off.disabled = false; }
  };
  again.onclick = async () => {
    again.disabled = true;
    state.textContent = t("restarting");
    await restart();
  };
}
