// "Make Enki Browser your default browser", asked once.
//
// Chromium's own "Chromium isn't your default browser" bar stays off (--no-default-browser-check
// in config/flags.txt): it would come back at every start. Instead, the first time Enki Browser
// starts as an installed browser on Windows, Shield opens one page (welcome.html) offering to open
// Windows' Default apps settings, where the user picks Enki Browser. It never opens again in that
// profile, whatever the answer, and "Make default" stays available in Shield's settings.
//
// Whether Enki Browser is registered and already the default is asked of the launcher
// (launcher/NativeHost.cs, "default-status"), which only reads the registry on this computer.
// Nothing goes over the network. No launcher to ask (Linux, macOS, a portable copy, an older
// launcher) means no page; Chromium's settings keep their own "Make default" button there.

export const SEEN = "defaultBrowserCardShown";
export const PAGE = "welcome.html";

/**
 * { registered, isDefault, portable } from the launcher, or null when there is none that knows
 * (an older launcher answers with its update status, which has no "registered").
 */
export async function defaultStatus(native) {
  const reply = await native({ type: "default-status" });
  if (!reply || reply.error || typeof reply.registered !== "boolean") return null;
  return { registered: reply.registered, isDefault: reply.isDefault === true, portable: reply.portable === true };
}

/** Opens Windows' Default apps settings at Enki Browser's page; true when it did. */
export async function openDefaultApps(native) {
  const reply = await native({ type: "open-default-apps" });
  return reply?.opened === true;
}

/**
 * Decides once per profile whether to show the page. Returns what happened: "seen" (already
 * decided), "unavailable" (no registered install to ask about; asked again next start, since a
 * self-update registers the browser on the start after the update), "default" (nothing to ask),
 * or "shown". The decision is stored before the page opens, so a crash or a second start never
 * shows it twice. Concurrent calls (onInstalled and onStartup on the same start) share one run.
 */
export function welcomeOnce({ native, storage, openPage }) {
  let running = null;
  async function run() {
    const stored = await storage.get(SEEN);
    if (stored?.[SEEN]) return "seen";
    const status = await defaultStatus(native);
    if (!status || !status.registered || status.portable) return "unavailable";
    await storage.set({ [SEEN]: Date.now() });
    if (status.isDefault) return "default";
    await openPage(PAGE);
    return "shown";
  }
  return () => (running ??= run().finally(() => { running = null; }));
}
