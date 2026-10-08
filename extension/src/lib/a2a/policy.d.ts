// Types for policy.js.
export const HOUR_MS: number;
export const LOG_MAX: number;
export type AgentColor = "blue" | "orange" | "green" | "purple" | "cyan" | "pink" | "yellow" | "red" | "grey";
export const AGENT_COLORS: Readonly<Record<AgentColor, string>>;
export function nextColor(used: string[]): AgentColor;
export function admit(input: { now: number; recent: number[]; pending: number; limits: { maxBundlesPerHourPerAgent: number; maxPendingNotices: number } }):
  { ok: boolean; reason?: "rate_limited" | "too_many_pending"; recent: number[] };
export function pushLog<T>(log: T[], entry: T, max?: number): T[];
export function pruneSeen(seen: Record<string, number>, now: number): Record<string, number>;
export function checkRelay(raw: unknown): { ok: true; url: string; origin: string } | { ok: false; reason: string };
export function holdQuery(input: { url: string; host: string; label?: string; group: string; sender: string; color: string }): string;
export function formatWhen(ms: number | undefined): string;
