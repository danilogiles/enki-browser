// Types for pairing.js (plain ES module shared with mcp/ and scripts/).
export const PAIR_TTL_MS: number;
export const MAX_AGENT_NAME: number;
export function cleanAgentName(raw: unknown): string | null;

export type CommitMessage = { v: 1; t: "commit"; c: string };
export type OfferMessage = { v: 1; t: "offer"; ed: string; x: string; nb: string };
export function browserReadCommit(msg: unknown): Uint8Array;
export function browserOffer(input: { browserEdPub: Uint8Array; browserXPub: Uint8Array; nB: Uint8Array }): OfferMessage;
export function browserReadReveal(
  msg: any,
  ctx: { browserXPrivate: CryptoKey; browserEdPub: Uint8Array; browserXPub: Uint8Array; nB: Uint8Array; code: string; commitment: Uint8Array },
): Promise<{ name: string; agentEdPub: Uint8Array; agentXPub: Uint8Array; nA: Uint8Array; agentId: string; fingerprint: string }>;

export type AgentPairState = { ed: CryptoKeyPair; x: CryptoKeyPair; agentEdPub: Uint8Array; agentXPub: Uint8Array; nA: Uint8Array; commit: CommitMessage };
export function agentStart(): Promise<AgentPairState>;
export function agentAnswerOffer(state: AgentPairState, offer: unknown, opts: { code: string; name: string }): Promise<{
  reveal: unknown; browserEdPub: Uint8Array; browserXPub: Uint8Array; mailbox: string; fingerprint: string;
}>;
export function agentCredential(state: AgentPairState, answer: { mailbox: string; browserXPub: Uint8Array }, opts: { relay: string; name: string }): Promise<string>;
export function pairAgent(options: {
  relay: string; code: string; name: string; confirm: (fingerprint: string) => Promise<boolean> | boolean;
  fetchImpl?: typeof fetch; pollMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void>;
}): Promise<{ credential: string; fingerprint: string; mailbox: string }>;
export { decodeCredential } from "./crypto.js";
