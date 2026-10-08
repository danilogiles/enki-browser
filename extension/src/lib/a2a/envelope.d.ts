// Types for envelope.js (plain ES module shared with mcp/, so it carries no TypeScript).
import type { Bundle, BundleIssue, BundleLimits, BundleValidation } from "./validate-bundle.js";

/** On the wire: { v: 1, alg: "enki-tabs-v1", to, from, eph, nonce, ct, sig } (see crypto.js). */
export type Envelope = { v: 1; alg: string; [field: string]: unknown };
export type Sealer = { alg: string; seal(paddedFrame: Uint8Array): Promise<Envelope> };
export type Opener = { alg: string; open(envelope: Envelope): Promise<Uint8Array> };
/** What travels inside a frame: the deliver_tabs schema's shape (no host/idn). */
export type WireBundle = { title: string; summary?: string; links: { url: string; label?: string }[] };
export type Frame = { v: 1; nonce: string; ts: number; bundle: WireBundle };

export const ENVELOPE_VERSION: 1;
export const FRAME_VERSION: 1;

export function newNonce(random?: (n: number) => Uint8Array): string;
export function toWireBundle(bundle: Bundle): WireBundle;
export function padFrame(frame: Frame, limits: BundleLimits): Uint8Array;
export function unpadFrame(bytes: Uint8Array, limits: BundleLimits): unknown;
export function sealBundle(
  bundle: Bundle,
  options: { sealer: Sealer; limits: BundleLimits; now?: number; nonce?: string },
): Promise<{ envelope: Envelope; wire: string; nonce: string; ts: number }>;

export type OpenResult =
  | { ok: true; bundle: Bundle; nonce: string; ts: number; warnings: BundleIssue[] }
  | { ok: false; reason: string; errors?: BundleIssue[] };

export function openEnvelope(
  wire: string | Uint8Array,
  options: {
    opener: Opener;
    validate: (input: unknown) => BundleValidation;
    limits: BundleLimits;
    seenNonce: (nonce: string) => boolean;
    now?: number;
  },
): Promise<OpenResult>;

export function toBase64(bytes: Uint8Array): string;
export function fromBase64(text: string): Uint8Array;
