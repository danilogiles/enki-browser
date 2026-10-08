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
export function holdQuery(input: { url: string; host: string; label?: string; group: string; sender: string; color: string; unchecked?: boolean }): string;
export function seenKey(agentId: string, nonce: string): string;
export function clearedHistory<A extends { lastPacketAt?: number }>(
  state: { agents: A[]; seen: Record<string, number>; floors?: Record<string, number> },
  now: number,
): { agents: Omit<A, "lastPacketAt">[]; pending: never[]; cards: never[]; log: never[]; seen: Record<string, never>; rate: Record<string, never>; floors: Record<string, number> };
export function belowFloor(input: { floors: Record<string, number> | undefined; agentId: string; until: number; now: number }): boolean;
export function formatWhen(ms: number | undefined): string;
