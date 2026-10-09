// Protected video (Widevine), in Enki Shields' settings.
//
// Streaming sites such as Crunchyroll need Widevine, Google's closed-source module, to play.
// Enki Browser does not ship it; on Windows the launcher downloads it from Google when the user
// turns it on here, after saying what it is (launcher/Widevine.cs, through launcher/NativeHost.cs),
// and keeps it current. Nothing is downloaded before the click on "Download from Google". macOS
// and Linux have no launcher to ask yet; they get the row with that said.

/** Shows the row and wires its buttons. `native` asks the launcher; `restart` restarts the browser. */
export async function showWidevine($, native, restart) {
  const state = $("widevine-state");
  const on = $("widevine-on"), off = $("widevine-off"), again = $("widevine-restart");
  const consent = $("widevine-consent"), go = $("widevine-go"), cancel = $("widevine-cancel");

  const render = (s, note) => {
    on.hidden = off.hidden = again.hidden = true;
    consent.hidden = true;
    if (!s) {
      state.textContent = "Can be turned on in Enki Browser for Windows; macOS and Linux come next.";
      return;
    }
    if (s.error) state.textContent = `Could not finish: ${s.error}`;
    else if (s.restartNeeded && s.installed) {
      state.textContent = `Widevine ${s.installed} is downloaded from Google and verified. Restart Enki Browser to use it; your tabs come back.`;
      again.hidden = false;
    } else if (s.installed && s.managed) state.textContent = `On · Widevine ${s.installed}, kept up to date from Google.`;
    else if (s.installed) state.textContent = `Widevine ${s.installed} was put here by hand; Enki does not keep it up to date.`;
    else state.textContent = note ?? "Off. Protected video does not play.";
    on.hidden = !!(s.installed && s.managed);
    on.textContent = s.installed && !s.managed ? "Keep it up to date" : "Turn on";
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
    state.textContent = "Downloading from Google and checking its signature… about 20 MB.";
    try { render(known(await native({ type: "widevine-install" }))); } finally { go.disabled = cancel.disabled = false; }
  };
  off.onclick = async () => {
    off.disabled = true;
    try { render(known(await native({ type: "widevine-remove" })), "Off. Widevine is removed from this computer."); } finally { off.disabled = false; }
  };
  again.onclick = async () => {
    again.disabled = true;
    state.textContent = "Restarting…";
    await restart();
  };
}
