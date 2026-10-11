// Types for validate-bundle.js (plain ES module shared with mcp/, so it carries no TypeScript).

export type BundleLink = { url: string; label?: string; host: string; idn: boolean };
/** A validated bundle. Every string in it is untrusted plain text: render with textContent only. */
export type Bundle = { title: string; summary?: string; links: BundleLink[] };
export type BundleIssue = { path: string; code: string; message: string };
export type BundleValidation =
  | { ok: true; errors: []; warnings: BundleIssue[]; bundle: Bundle }
  | { ok: false; errors: BundleIssue[]; warnings: BundleIssue[]; bundle: null };

export type BundleLimits = Readonly<{
  maxTitle: number;
  maxSummary: number;
  minLinks: number;
  maxLinks: number;
  maxUrlLength: number;
  maxLabel: number;
  maxBundleBytes: number;
  maxBundlesPerHourPerAgent: number;
  maxPendingNotices: number;
  relayTtlSeconds: number;
  maxPacketAgeSeconds: number;
  maxClockSkewSeconds: number;
  maxEnvelopeBytes: number;
  paddedFrameBytes: number;
}>;

export type UrlCheck = { ok: true; url: string; host: string; idn: boolean } | { ok: false; code: string; message: string };

export function codePointLength(s: string): number;
export function normalizeText(value: string, options?: { multiline?: boolean }): string;
export function checkUrl(raw: unknown, options?: { maxLength?: number }): UrlCheck;
export function limitsFromSchema(schema: unknown): BundleLimits;
export function assertSupportedSchema(node: unknown, path?: string): void;
export function createBundleValidator(schema: unknown): (input: unknown) => BundleValidation;
export function formatErrors(errors: BundleIssue[]): string;
