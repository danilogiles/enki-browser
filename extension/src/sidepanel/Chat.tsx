import { Fragment, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, Loader2, RotateCw, ShieldAlert, X } from "lucide-react";
import logo from "../assets/logo.svg";
import type { Mode } from "../lib/agent/prompt";
import type { Segment, UiMessage } from "./types";
import { visualComponents } from "./Visuals";
import { t } from "./strings";

/**
 * The conversation, kept clean: each reply shows its answer, with the work behind it — the steps,
 * the reasoning, the outcome — folded away behind small arrows. Two things are never folded:
 * the approval card for a sensitive action, and errors, because hiding either would be unsafe or
 * leave the user stuck.
 */
export type Progress = { message: string; step: number; maxSteps: number; elapsed: number };

type Props = {
  messages: UiMessage[];
  approval: { label: string; confirm?: import("../lib/tools/executor").ConfirmPayload; resolve: (ok: boolean) => void } | null;
  mode: Mode;
  onSuggest: (text: string) => void;
  onRetry?: () => void;
  showSteps: boolean;
  showRunDetails: boolean;
  progress: Progress | null;
};

const SUGGESTIONS: Record<Mode, string[]> = { ask: t.suggestAsk, act: t.suggestAct };

export function Chat({ messages, approval, mode, onSuggest, onRetry, showSteps, showRunDetails, progress }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, approval]);

  if (!messages.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <img src={logo} alt="" className="h-10 w-10 opacity-90" />
        <div className="text-sm text-zinc-400">
          {mode === "ask" ? t.emptyAsk : t.emptyAct}
        </div>
        <div className="flex flex-wrap justify-center gap-1.5">
          {SUGGESTIONS[mode].map((s) => (
            <button key={s} type="button" onClick={() => onSuggest(s)}
              className="rounded-full border border-ink-700 px-3 py-1 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-100">
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      <div className="flex flex-col gap-5">
        {messages.map((m, idx) => {
          const last = idx === messages.length - 1;
          return (
            <MessageView key={m.id} message={m} approval={approval} onRetry={last ? onRetry : undefined}
              showSteps={showSteps} showRunDetails={showRunDetails} progress={last && m.streaming ? progress : null} />
          );
        })}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}

function MessageView({ message, approval, onRetry, showSteps, showRunDetails, progress }: {
  message: UiMessage;
  approval: Props["approval"];
  onRetry?: () => void;
  showSteps: boolean;
  showRunDetails: boolean;
  progress: Progress | null;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl bg-ink-800 px-3.5 py-2 text-sm text-zinc-100">
          {message.screenshot && (
            <img src={message.screenshot} alt={t.screenshotAttached} className="mb-2 max-h-28 rounded-md border border-ink-700 object-cover" />
          )}
          <div className="whitespace-pre-wrap">{message.text}</div>
        </div>
      </div>
    );
  }

  const segments = message.segments ?? [];
  const tools = segments.filter((s): s is Extract<Segment, { kind: "tool" }> => s.kind === "tool");
  const texts = segments.filter((s): s is Extract<Segment, { kind: "text" }> => s.kind === "text" && !!s.text);
  const awaiting = tools.find((t) => t.status === "awaiting");
  const working = !!message.streaming;

  return (
    <div className="flex flex-col gap-2 text-sm">
      {(working || tools.length > 0 || message.thinking) && (
        showSteps
          ? <Steps tools={tools} thinking={message.thinking} working={working} progress={progress} />
          : working && <WorkingLine progress={progress} />
      )}
      {awaiting && approval && <ApprovalCard label={approval.label} confirm={approval.confirm} onDecide={approval.resolve} />}
      {texts.map((s, i) => (
        <div key={i} className={`md ${working && i === texts.length - 1 ? "cursor-blink" : ""}`}>
          <Markdown remarkPlugins={[remarkGfm]} components={visualComponents}>{s.text}</Markdown>
        </div>
      ))}
      {message.error && (
        <div className="flex flex-col gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span className="break-words">{message.error}</span>
          </div>
          {onRetry && (
            <div className="flex justify-end">
              <button type="button" onClick={onRetry}
                className="inline-flex items-center gap-1 rounded-md bg-red-500/20 px-2.5 py-1 font-medium text-red-100 transition hover:bg-red-500/30">
                <RotateCw size={11} /> {t.tryAgain}
              </button>
            </div>
          )}
        </div>
      )}
      {showRunDetails && !working && (message.summary || message.note) && <RunDetails message={message} />}
    </div>
  );
}

/** One line while the task runs, when steps are hidden. */
function WorkingLine({ progress }: { progress: Progress | null }) {
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <Loader2 size={12} className="animate-spin" />
      <span className="truncate">{progress ? describe(progress) : t.working}</span>
    </div>
  );
}

function describe(p: Progress): string {
  return `${p.message}${p.step > 0 ? ` · ${t.step} ${p.step}` : ""} · ${p.elapsed}s`;
}

/** The steps a reply took, folded behind an arrow; expanded while the user wants to watch. */
function Steps({ tools, thinking, working, progress }: {
  tools: Array<Extract<Segment, { kind: "tool" }>>;
  thinking?: string;
  working: boolean;
  progress: Progress | null;
}) {
  const [open, setOpen] = useState(false);
  const failed = tools.filter((t) => t.status === "error").length;
  const label = working
    ? progress ? describe(progress) : t.working
    : tools.length
      ? `${t.steps(tools.length)}${failed ? ` · ${t.failedN(failed)}` : ""}`
      : t.reasoning;
  return (
    <div className="text-xs text-zinc-500">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex max-w-full items-center gap-1.5 rounded-md py-0.5 pr-1 transition hover:text-zinc-300">
        {open ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
        {working && <Loader2 size={12} className="shrink-0 animate-spin" />}
        <span className="truncate">{label}</span>
      </button>
      {/* Rendered but hidden when folded, so the page's text (and assistive tech) still has it. */}
      <div hidden={!open} className="mt-1.5 flex flex-col gap-1.5 border-l border-ink-700 pl-3">
        {thinking && <div className="whitespace-pre-wrap text-zinc-500">{thinking}</div>}
        {tools.map((t) => <ToolChip key={t.id} seg={t} />)}
      </div>
    </div>
  );
}

/** The outcome after a reply, folded: what finished, what failed, and any notice. */
function RunDetails({ message }: { message: UiMessage }) {
  const s = message.summary;
  const outcome = !s ? t.details : s.outcome === "finished" ? t.done : s.outcome === "needs_input" ? t.needsInput : t.notComplete;
  return (
    <details className="group text-xs text-zinc-500">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md py-0.5 pr-1 transition hover:text-zinc-300 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={13} className="transition group-open:rotate-90" />
        {outcome}
      </summary>
      <div className="mt-1.5 flex flex-col gap-1 border-l border-ink-700 pl-3">
        {s && <div>{t.toolResults(s.succeeded, s.failed)}</div>}
        {s && s.succeeded > 0 && <div>{t.toolConfirm}</div>}
        {message.note && <div>{message.note}</div>}
      </div>
    </details>
  );
}

function ToolChip({ seg }: { seg: Extract<Segment, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const icon =
    seg.status === "running" ? <Loader2 size={12} className="animate-spin text-enki-400" />
    : seg.status === "awaiting" ? <ShieldAlert size={12} className="text-amber-400" />
    : seg.status === "done" ? <Check size={12} className="text-zinc-400" />
    : seg.status === "declined" ? <Ban size={12} className="text-zinc-400" />
    : <X size={12} className="text-red-400" />;
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left text-zinc-400 hover:text-zinc-200">
        {icon}
        <span className="truncate">{seg.label}</span>
      </button>
      {open && seg.output !== undefined && (
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-ink-900 px-2 py-1.5 text-[11px] leading-snug text-zinc-400">{seg.output}</pre>
      )}
    </div>
  );
}

function ApprovalCard({ label, confirm, onDecide }: {
  label: string;
  confirm?: import("../lib/tools/executor").ConfirmPayload;
  onDecide: (ok: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  const verb = confirm?.verb || label;
  const origin = confirm?.destinationUnknown ? t.approvalUnknownDestination : (confirm?.origin ?? "");
  const value = confirm?.value ?? "";
  const filled = confirm?.filled;
  const pageRequested = !!confirm?.pageRequested;
  // A submit card always shows its field list: the filled rows, or "Enki didn't fill in any fields."
  const isSubmitCard = Array.isArray(filled);
  const rows = isSubmitCard
    ? filled!
    : value
      ? value.split("\n").filter(Boolean).map((line) => {
          const i = line.indexOf(": ");
          return i >= 0 ? { name: line.slice(0, i), value: line.slice(i + 2) } : { name: "", value: line };
        })
      : [];
  const needsClamp = rows.length > 4 || rows.some((r) => r.value.length > 80);
  const shownRows = !needsClamp || expanded ? rows : rows.slice(0, 4);
  const allowLabel = pageRequested ? t.allowAnyway : t.allow;
  return (
    <div
      role="alertdialog"
      aria-label={t.approvalAria}
      aria-modal="false"
      className={`rounded-xl px-3 py-3 text-xs ${pageRequested
        ? "border-[1.5px] border-amber-500 bg-amber-500/[0.08]"
        : "border border-ink-700 bg-ink-900"}`}
    >
      <div className="flex items-start gap-2 text-zinc-100">
        <span className={`mt-0.5 grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg ${pageRequested ? "bg-amber-500/15 text-amber-300" : "bg-sky-400/15 text-[#38bdf8]"}`}>
          <ShieldAlert size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug text-zinc-50">{verb}</div>
          {origin && (
            <div className="mt-0.5 font-mono text-[12px] leading-snug text-zinc-400 truncate" title={origin}>{origin}</div>
          )}
        </div>
      </div>
      {filled && filled.length > 0 && (
        <p className="mt-2 text-[12px] text-zinc-400">{t.approvalReview}</p>
      )}
      {isSubmitCard && rows.length === 0 && (
        <div className="mt-2 rounded-lg border border-ink-800 bg-ink-950 px-2.5 py-2 text-[11px] leading-snug text-zinc-400">{t.approvalNoFields}</div>
      )}
      {rows.length > 0 && (
        <div className="mt-2 rounded-lg border border-ink-800 bg-ink-950 px-2.5 py-2 text-[11px] leading-snug">
          <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1">
            {shownRows.map((r, i) => (
              <Fragment key={i}>
                <dt className="text-zinc-500">{r.name || "—"}</dt>
                <dd className={`m-0 text-zinc-200 ${expanded ? "whitespace-pre-wrap break-words" : "truncate"}`}>{r.value}</dd>
              </Fragment>
            ))}
          </dl>
          {needsClamp && (
            <button
              type="button"
              className="mt-1 rounded px-0 py-0.5 text-[11.5px] text-[#38bdf8]"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >{expanded ? t.approvalShowLess : t.approvalShowAll}</button>
          )}
        </div>
      )}
      {pageRequested && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-1.5 text-[12px] font-semibold text-amber-300">
          <ShieldAlert size={14} className="shrink-0" />
          <span>{t.approvalPageRequested}</span>
        </div>
      )}
      {!rows.length && !confirm && (
        <div className="mt-2 text-zinc-300">{t.approvalPre}<strong>{label}</strong>{t.approvalPost}</div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          ref={cancelRef}
          type="button"
          autoFocus
          onClick={() => onDecide(false)}
          className={`h-[34px] rounded-lg text-[13px] font-semibold transition ${pageRequested
            ? "border border-zinc-200 bg-zinc-100 text-ink-950 hover:bg-white"
            : "border border-ink-600 bg-transparent text-zinc-200 hover:bg-ink-800"}`}
        >{t.deny}</button>
        <button
          type="button"
          onClick={() => onDecide(true)}
          className={`h-[34px] rounded-lg text-[13px] font-semibold transition ${pageRequested
            ? "border border-amber-500/60 bg-transparent text-amber-300 hover:bg-amber-500/10"
            : "border border-[#38bdf8] bg-[#38bdf8] text-[#06202d] hover:bg-sky-300"}`}
        >{allowLabel}</button>
      </div>
    </div>
  );
}
