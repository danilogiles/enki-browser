import { AlertTriangle, Ban, LockOpen } from "lucide-react";
import type { EndpointNotice } from "../lib/providers/endpoint-policy";
import { ENDPOINT_STRINGS as E, NOTICE_STRINGS as N, revokeLabel } from "../lib/providers/endpoint-strings";

/**
 * The one-time 0.8.12 notice about the saved model address (lib/settings.ts, SETTINGS_VERSION 2).
 * UI only: it is never added to the conversation, the model's context or any request.
 */
export function EndpointNoticeCard({ notice, onRevoke, onDismiss, onOpenSettings }: {
  notice: EndpointNotice;
  onRevoke: (origin: string) => void;
  onDismiss: () => void;
  onOpenSettings: () => void;
}) {
  const hostPort = notice.origin.replace(/^[a-z]+:\/\//, "");
  // Ink's bodies name {origin} themselves; only the composed private-off text needs it shown apart.
  const endpoint = <code className="block break-all font-mono text-[11px] text-zinc-300">{notice.origin}</code>;
  if (notice.kind === "carried") {
    return (
      <div role="status" data-notice="carried" className="mx-3 mb-1 space-y-1.5 rounded-lg border border-amber-400/45 bg-[#2e2a1c] px-3 py-2 text-xs text-zinc-200">
        <b className="flex items-center gap-1.5 text-[13px]"><LockOpen size={13} className="text-amber-200" />{N.migCarriedTitle}</b>
        <p>{N.migCarriedBody(notice.origin)}</p>
        <p role="note" className="flex items-start gap-1.5 text-[#cfae43]"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{E.warn}</p>
        <div className="flex gap-2 pt-0.5">
          <button type="button" aria-label={revokeLabel(hostPort)} onClick={() => onRevoke(notice.origin)} className="rounded border border-amber-400/45 px-2 py-1 text-amber-200 hover:bg-ink-800">{E.revoke}</button>
          <button type="button" onClick={onDismiss} className="rounded px-2 py-1 text-zinc-300 underline hover:bg-ink-800">{N.migDismiss}</button>
        </div>
      </div>
    );
  }
  const body = notice.kind === "blocked-host" ? N.migBlockedHostBody(notice.origin)
    : notice.kind === "blocked-public" ? N.migBlockedPublicBody(notice.origin)
    : notice.kind === "blocked-key" ? N.migBlockedKeyBody(notice.origin)
    // CARRY_OVER_PRIVATE_HTTP off: blocked until the user turns the toggle on, and this says where.
    : `${E.offNote} Settings → Model → ${E.toggle}.`;
  return (
    <div role="status" data-notice={notice.kind} className="mx-3 mb-1 space-y-1.5 rounded-lg border border-[#e8928d]/70 bg-ink-900 px-3 py-2 text-xs text-[#f2b8b5]">
      <b className="flex items-center gap-1.5 text-[13px]"><Ban size={13} />{N.migBlockedTitle}</b>
      <p>{body}</p>
      {notice.kind === "private-off" && endpoint}
      <div className="flex gap-2 pt-0.5">
        {/* Ink's blocked variants have one action: opening the settings also ends the notice. */}
        <button type="button" onClick={onOpenSettings} className="rounded border border-[#e8928d]/70 px-2 py-1 hover:bg-ink-800">{N.migOpenSettings}</button>
      </div>
    </div>
  );
}
