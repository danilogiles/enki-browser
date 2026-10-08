/**
 * Receive tabs (0.9): every link goes through Enki Shield before the notice is shown, and one
 * blocked link rejects the whole packet (threat model §3).
 *
 * Enki Shield is a separate built-in extension (shield/). Enki Browser's build writes the Shield's
 * fixed id into Enki's ids.json (build/common.mjs), and the Shield answers "shield:check" for
 * Enki's id only (shield/background.js, onMessageExternal). The check runs on the Shield's local
 * list: no URL leaves the device.
 *
 * Fail closed: when Enki Browser says a Shield exists but it does not answer, the packet is
 * rejected. Only where no Shield is shipped at all (the extension installed on its own in another
 * browser) do links go unchecked, and the notice says so.
 */
export type ShieldVerdict = { ok: true; checked: boolean } | { ok: false; reason: "shield_blocked" | "shield_unavailable"; url?: string };

let shieldId: Promise<string | null> | null = null;
function getShieldId(): Promise<string | null> {
  shieldId ??= fetch(chrome.runtime.getURL("ids.json"))
    .then((r) => (r.ok ? r.json() : {}))
    .then((ids: { shield?: unknown }) => (typeof ids.shield === "string" && /^[a-p]{32}$/.test(ids.shield) ? ids.shield : null))
    .catch(() => null);
  return shieldId;
}

async function ask(id: string, url: string): Promise<{ domain: boolean; page: boolean } | null> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 5000));
  const answer = chrome.runtime.sendMessage(id, { type: "shield:check", url }).catch(() => null) as Promise<unknown>;
  const res = (await Promise.race([answer, timeout])) as { domain?: unknown; page?: unknown } | null;
  return res && typeof res.domain === "boolean" && typeof res.page === "boolean" ? { domain: res.domain, page: res.page } : null;
}

export async function shieldCheck(urls: string[]): Promise<ShieldVerdict> {
  const id = await getShieldId();
  if (!id) return { ok: true, checked: false };
  for (const url of urls) {
    const res = await ask(id, url);
    if (!res) return { ok: false, reason: "shield_unavailable", url };
    if (res.domain || res.page) return { ok: false, reason: "shield_blocked", url };
  }
  return { ok: true, checked: true };
}
