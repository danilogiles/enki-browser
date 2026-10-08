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
 * browser, so no ids.json) do links go unchecked: the notice says "Links não verificados pelo Enki
 * Shield", the hold page says it again, and the tabs still wait on hold.html until Abrir.
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

/** True only for messages from the Enki Shield this build was shipped with. */
export async function isShield(senderId: string | undefined): Promise<boolean> {
  const id = await getShieldId();
  return !!id && senderId === id;
}

/**
 * When the user last used the Shield's Burn (🔥 Burn all data, or burn-on-close at the next start),
 * by the Shield's own clock; 0 if never, null where there is no Shield or it does not answer.
 * Read-only and local: the Shield answers this for Enki's id only.
 */
export async function shieldBurnedAt(): Promise<number | null> {
  const id = await getShieldId();
  if (!id) return null;
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 5000));
  const answer = chrome.runtime.sendMessage(id, { type: "shield:burned-at" }).catch(() => null) as Promise<unknown>;
  const res = (await Promise.race([answer, timeout])) as { at?: unknown } | null;
  return res && typeof res.at === "number" ? res.at : null;
}
