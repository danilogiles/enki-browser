// "Check for updates", in Enki Shields' settings.
//
// On Windows it asks Enki Browser's own updater to check now (the launcher, through native
// messaging: launcher/NativeHost.cs). That is the same signed, verified download the browser makes
// by itself every couple of hours, and the browser then restarts into it with every tab. macOS and
// Linux have no updater yet: there it asks GitHub for the number of the latest release and links
// to the download.

const HOST = "io.github.danilogiles.enki_browser";
const LATEST = "https://api.github.com/repos/danilogiles/enki-browser/releases/latest";
export const DOWNLOAD = "https://github.com/danilogiles/enki-browser/releases/latest";

/** The Enki Browser version this Shield shipped with (written by the build into ids.json). */
export async function shippedVersion() {
  const ids = await fetch(chrome.runtime.getURL("ids.json")).then((r) => r.json()).catch(() => ({}));
  return typeof ids.browser === "string" ? ids.browser : null;
}

/** One request to the launcher; null when there is none to ask (not Windows, or portable). */
function native(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(HOST, message, (reply) => resolve(chrome.runtime.lastError ? null : reply ?? null));
    } catch { resolve(null); }
  });
}

/** -1, 0 or 1, comparing "0.8.1"-style versions. */
export function compare(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** What the page shows before anyone clicks: the running version and an update already waiting. */
export async function status() {
  const reply = await native({ type: "status" });
  if (reply && !reply.error) return { updater: true, ...reply };
  return { updater: false, running: await shippedVersion() };
}

/**
 * Checks now. With the updater: { updater: true, running, ready, latest, updatesOff, error }.
 * Without: { updater: false, running, latest, error } from GitHub, where `latest` newer than
 * `running` means a download is available.
 */
export async function check() {
  const reply = await native({ type: "check" });
  if (reply) return { updater: true, ...reply };
  const running = await shippedVersion();
  try {
    const res = await fetch(LATEST, { headers: { Accept: "application/vnd.github+json" }, credentials: "omit" });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const latest = String((await res.json()).tag_name ?? "").replace(/^v/, "");
    return { updater: false, running, latest: latest || null };
  } catch (e) {
    return { updater: false, running, latest: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Restarts the browser into the update that is waiting; every window and tab comes back. */
export function restart() {
  return native({ type: "restart" });
}
