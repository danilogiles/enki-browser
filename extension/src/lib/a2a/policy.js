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

/** Key of a seen nonce: per agent, so "Limpar histórico" can keep one replay floor per agent. */
export function seenKey(agentId, nonce) {
  return `${agentId}:${nonce}`;
}

/**
 * "Limpar histórico de abas recebidas" (and Enki Shield's Burn): what Receive tabs keeps after it.
 *
 * Gone: waiting notices, summary cards, the 50-packet log, every agent's "Último pacote" date, the
 * hourly counters and the seen nonces. Kept: the paired agents (name, color, fingerprint, public
 * keys, mailbox) and, outside this function, their non-exportable keys in IndexedDB.
 *
 * Dropping the seen nonces outright would let the relay replay an already-seen packet during the
 * minutes it is still young enough to pass the age check. So each agent keeps one number instead,
 * its replay floor: the moment its newest seen packet stops passing the age check. Until then a
 * packet of that agent stamped no later than that one is refused as a replay; after it the age
 * check alone refuses them, and the floor is pruned. No nonce, title or link survives.
 * Seen keys without an agent (none are written any more) give a floor that applies to every agent.
 */
export function clearedHistory({ agents, seen, floors }, now) {
  const next = pruneSeen(floors ?? {}, now);
  for (const [key, until] of Object.entries(pruneSeen(seen ?? {}, now))) {
    const i = key.indexOf(":");
    const agent = i > 0 ? key.slice(0, i) : "*";
    next[agent] = Math.max(next[agent] ?? 0, until);
  }
  return {
    agents: agents.map(({ lastPacketAt: _drop, ...a }) => a),
    pending: [],
    cards: [],
    log: [],
    seen: {},
    rate: {},
    floors: next,
  };
}

/** True when a packet that passed every other check is older than what was cleared (a replay). */
export function belowFloor({ floors, agentId, until, now }) {
  const live = pruneSeen(floors ?? {}, now);
  return until <= Math.max(live[agentId] ?? 0, live["*"] ?? 0);
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
export function holdQuery({ url, host, label, group, sender, color, unchecked }) {
  const q = new URLSearchParams({ u: url, h: host, t: label || host, g: group, s: sender, c: color });
  // Only where no Enki Shield exists (the extension on its own): the hold page says so too.
  if (unchecked) q.set("v", "0");
  return `?${q.toString()}`;
}

/** Short, human date for "Último pacote", in Portuguese like the rest of this feature's UI. */
export function formatWhen(ms) {
  if (!ms) return "nunca";
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms).replace(".", "");
}
