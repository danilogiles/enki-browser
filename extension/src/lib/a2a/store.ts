/**
 * Receive tabs (0.9): what is kept in chrome.storage, shared by the service worker (which writes)
 * and the panel and settings (which read and send requests). Nothing here ever leaves the device.
 * Every title, summary, label and agent name is untrusted plain text: render with textContent
 * (React text nodes), never as HTML or Markdown, never into the assistant.
 */
import type { AgentColor } from "./policy.js";

export const K = {
  settings: "enki:agents:settings",
  agents: "enki:agents:list",
  pending: "enki:agents:pending",
  cards: "enki:agents:cards",
  log: "enki:agents:log",
  seen: "enki:agents:seen",
  rate: "enki:agents:rate",
  /** After "Limpar histórico": one replay floor per agent, minutes long (policy.clearedHistory). */
  floors: "enki:agents:replay-floors",
  /** The last Enki Shield Burn this extension already followed (Shield's own timestamp). */
  burnSynced: "enki:agents:burn-synced",
  /** chrome.storage.session: the pairing in progress, public parts only (no keys). */
  pairing: "enki:agents:pairing",
} as const;

export type AgentSettings = { enabled: boolean; relay: string };
export const DEFAULT_AGENT_SETTINGS: AgentSettings = { enabled: false, relay: "" };

export type AgentRecord = {
  id: string;
  name: string;
  color: AgentColor;
  fingerprint: string;
  agentEdPub: string;
  agentXPub: string;
  mailbox: string;
  relay: string;
  pairedAt: number;
  lastPacketAt?: number;
};

export type NoticeLink = { url: string; host: string; label?: string; idn: boolean };
export type Notice = {
  id: string;
  agentId: string;
  receivedAt: number;
  title: string;
  summary?: string;
  links: NoticeLink[];
  /** False only where no Enki Shield is shipped (the extension alone in another browser). */
  shieldChecked: boolean;
};

export type SummaryCard = { id: string; agentId: string; title: string; summary?: string; hosts: string[]; tabs: number; openedAt: number };

export type LogEntry = {
  at: number;
  agentId?: string;
  title?: string;
  links?: number;
  outcome: "pending" | "accepted" | "declined" | "rejected" | "dropped";
  reason?: string;
};

export type PairingView =
  | { step: "waiting" | "offered"; code: string; exp: number }
  | { step: "confirm"; code: string; exp: number; name: string; fingerprint: string; color: AgentColor }
  | { step: "failed"; code: string; exp: number; error: string };

export type AgentRequest =
  | { type: "agents:set"; settings: Partial<AgentSettings> }
  | { type: "agents:pair-start" }
  | { type: "agents:pair-poll" }
  | { type: "agents:pair-confirm" }
  | { type: "agents:pair-cancel" }
  | { type: "agents:unpair"; id: string }
  | { type: "agents:poll-now" }
  | { type: "agents:accept"; id: string; windowId?: number }
  | { type: "agents:decline"; id: string }
  | { type: "agents:dismiss-card"; id: string }
  | { type: "agents:clear-history" };

export type AgentReply = { ok: true; [k: string]: unknown } | { ok: false; error: string };

export function request(msg: AgentRequest): Promise<AgentReply> {
  return chrome.runtime.sendMessage(msg).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
}
