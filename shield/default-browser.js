// First-run guide (welcome.html): asked once per profile.
//
// Chromium's own "Chromium isn't your default browser" bar stays off (--no-default-browser-check
// in config/flags.txt): it would come back at every start. Instead, the first time Enki Browser
// starts, Shield opens one short guide (welcome.html): make Enki the default (Windows), set up
// the AI, and a one-line Shield summary. It never opens again in that profile, whatever the
// answer. "Make default" and "Ver o guia de novo" stay available in Shield's settings.
//
// Whether Enki Browser is registered and already the default is asked of the launcher
// (launcher/NativeHost.cs, "default-status"), which only reads the registry on this computer.
// Nothing goes over the network. A Windows install that is not registered yet (first start after
// a self-update that still has to sync) waits and is asked again next start. Linux, macOS and
// portable copies still get the guide once; step 1 just skips the Windows Settings button.
//
// 0.8.6 will insert an "Importar favoritos" step between default-browser and AI (see welcome.js).

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
 * Decides once per profile whether to show the guide. Returns what happened: "seen" (already
 * decided), "unavailable" (Windows install not registered yet; asked again next start, since a
 * self-update registers the browser on the start after the update), or "shown". The decision is
 * stored before the page opens, so a crash or a second start never shows it twice. Concurrent
 * calls (onInstalled and onStartup on the same start) share one run.
 */
export function welcomeOnce({ native, storage, openPage }) {
  let running = null;
  async function run() {
    const stored = await storage.get(SEEN);
    if (stored?.[SEEN]) return "seen";
    const status = await defaultStatus(native);
    // Launcher present, not portable, not registered: wait for Install.SyncRegistration.
    if (status && !status.registered && !status.portable) return "unavailable";
    await storage.set({ [SEEN]: Date.now() });
    await openPage(PAGE);
    return "shown";
  }
  return () => (running ??= run().finally(() => { running = null; }));
}
