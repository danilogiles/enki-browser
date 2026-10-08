/**
 * Receive tabs (0.9): Enki's local rules, kept pure so they can be tested without a browser.
 * Dependency-free ES module like the rest of a2a/.
 */

export const HOUR_MS = 3_600_000;
export const LOG_MAX = 50;

/** Tab group colors Chromium accepts, and what the UI paints for each. */
export const AGENT_COLORS = Object.freeze({
  blue: "#8ab4f8", orange: "#fcad70", green: "#81c995", purple: "#c58af9", cyan: "#78d9ec",
  pink: "#ff8bcb", yellow: "#fdd663", red: "#f28b82", grey: "#9aa0a6",
});
const ORDER = Object.keys(AGENT_COLORS);

/** The first color no paired agent uses yet (then cycle). */
export function nextColor(used) {
  return ORDER.find((c) => !used.includes(c)) ?? ORDER[used.length % ORDER.length];
}

/**
 * Whether a packet that passed every other check may become a notice.
 * `recent` = timestamps of this agent's authenticated packets; `pending` = notices waiting.
 * Over either limit the packet is dropped silently (only the local log records it).
 */
export function admit({ now, recent, pending, limits }) {
  const window = recent.filter((t) => now - t < HOUR_MS);
  if (window.length >= limits.maxBundlesPerHourPerAgent) return { ok: false, reason: "rate_limited", recent: window };
  if (pending >= limits.maxPendingNotices) return { ok: false, reason: "too_many_pending", recent: [...window, now] };
  return { ok: true, recent: [...window, now] };
}

/** Newest first, at most 50 entries. */
export function pushLog(log, entry, max = LOG_MAX) {
  return [entry, ...log].slice(0, max);
}

/** Seen nonces are kept until the packet could no longer be accepted anyway (age limit + skew). */
export function pruneSeen(seen, now) {
  const out = {};
  for (const [nonce, until] of Object.entries(seen)) if (until > now) out[nonce] = until;
  return out;
}

/** The relay must be https; plain http only for a relay on this computer (development). */
export function checkRelay(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return { ok: false, reason: "URL inválida" }; }
  if (u.username || u.password || u.search || u.hash) return { ok: false, reason: "Sem usuário, senha, ? ou # no endereço" };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const loopback = host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) return { ok: false, reason: "O relay precisa usar https://" };
  return { ok: true, url: u.href.replace(/\/+$/, ""), origin: u.origin };
}

/** hold.html?… for one link. Everything in it is shown with textContent only. */
export function holdQuery({ url, host, label, group, sender, color }) {
  const q = new URLSearchParams({ u: url, h: host, t: label || host, g: group, s: sender, c: color });
  return `?${q.toString()}`;
}

/** Short, human date for "Último pacote", in Portuguese like the rest of this feature's UI. */
export function formatWhen(ms) {
  if (!ms) return "nunca";
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms).replace(".", "");
}
