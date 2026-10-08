// Types for crypto.js (plain ES module shared with mcp/, relay/ and scripts/, so it carries no TypeScript).
import type { Opener, Sealer } from "./envelope.js";

export const TABS_ALG: "enki-tabs-v1";
export const PAIR_VERSION: 1;
export const MAILBOX_ID: RegExp;
export const PAIR_MAILBOX_ID: RegExp;
export const PAIR_CODE: RegExp;
export const RELAY_SKEW_MS: number;

export function b64u(bytes: Uint8Array): string;
export function unb64u(text: string, length?: number): Uint8Array;
export function hex(bytes: Uint8Array): string;
export function unhex(text: string): Uint8Array;
export function concat(...parts: Uint8Array[]): Uint8Array;
export function lp(bytes: Uint8Array): Uint8Array;
export function crockford(bytes: Uint8Array): string;
export function sha256(bytes: Uint8Array): Promise<Uint8Array>;
export function randomBytes(n: number): Uint8Array;
export function codeError(code: string, message?: string): Error & { code: string };

export function mailboxIdFor(browserEdPub: Uint8Array): Promise<string>;
export function agentIdFor(agentEdPub: Uint8Array): Promise<string>;
export function newPairCode(): string;
export function normalizePairCode(input: unknown): string | null;
export function pairMailboxIds(code: string): Promise<{ browser: string; agent: string }>;
export function pairCommitment(agentEdPub: Uint8Array, agentXPub: Uint8Array, nA: Uint8Array): Promise<Uint8Array>;
export type FingerprintInput = {
  agentEdPub: Uint8Array; agentXPub: Uint8Array; nA: Uint8Array;
  browserEdPub: Uint8Array; browserXPub: Uint8Array; nB: Uint8Array; code: string;
};
export function pairFingerprint(input: FingerprintInput): Promise<string>;
export function revealTranscript(input: FingerprintInput & { name: string }): Uint8Array;

export function newEd25519(extractable: boolean): Promise<CryptoKeyPair>;
export function newX25519(extractable: boolean): Promise<CryptoKeyPair>;
export function rawPublic(key: CryptoKey): Promise<Uint8Array>;
export function importEdPrivate(pkcs8: Uint8Array): Promise<CryptoKey>;
export function importXPrivate(pkcs8: Uint8Array): Promise<CryptoKey>;
export function sign(edPrivate: CryptoKey, bytes: Uint8Array): Promise<Uint8Array>;
export function verify(edPublicRaw: Uint8Array, sig: Uint8Array, bytes: Uint8Array): Promise<boolean>;

export function createSealer(options: {
  mailbox: string;
  agent: { edPrivate: CryptoKey; xPrivate: CryptoKey; edPub: Uint8Array; xPub: Uint8Array };
  browser: { xPub: Uint8Array };
}): Sealer;
export function createOpener(options: {
  mailbox: string;
  browser: { xPrivate: CryptoKey; xPub: Uint8Array };
  agent: { edPub: Uint8Array; xPub: Uint8Array };
  expectedFrameBytes?: number;
}): Opener;

export type RevealMessage = { v: 1; t: "reveal"; eph: string; nonce: string; ct: string };
export function sealReveal(plain: unknown, browserXPub: Uint8Array): Promise<RevealMessage>;
export function openReveal(msg: RevealMessage, browserXPrivate: CryptoKey, browserXPub: Uint8Array): Promise<any>;

export function signRelayRequest(options: { method: string; mailbox: string; edPrivate: CryptoKey; edPub: Uint8Array; now?: number }): Promise<Record<string, string>>;
export function verifyRelayRequest(options: { method: string; mailbox: string; headers: Headers | Record<string, string | undefined>; now?: number }): Promise<boolean>;

export type Credential = {
  relay: string; mailbox: string; name: string; browserXPub: Uint8Array;
  agentEdPkcs8: Uint8Array; agentXPkcs8: Uint8Array; agentEdPub: Uint8Array; agentXPub: Uint8Array;
};
export function encodeCredential(c: Credential): string;
export function decodeCredential(text: string): Credential;
export function sealerFromCredential(text: string): Promise<{ credential: { relay: string; mailbox: string; name: string }; sealer: Sealer }>;
