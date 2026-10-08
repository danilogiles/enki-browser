import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, Loader2, RotateCw, ShieldAlert, X } from "lucide-react";
import logo from "../assets/logo.svg";
import type { Mode } from "../lib/agent/prompt";
import type { Segment, UiMessage } from "./types";
import { visualComponents } from "./Visuals";

/**
 * The conversation, kept clean: each reply shows its answer, with the work behind it — the steps,
 * the reasoning, the outcome — folded away behind small arrows. Two things are never folded:
 * the approval card for a sensitive action, and errors, because hiding either would be unsafe or
 * leave the user stuck.
 */
export type Progress = { message: string; step: number; maxSteps: number; elapsed: number };

type Props = {
  messages: UiMessage[];
  approval: { label: string; resolve: (ok: boolean) => void } | null;
  mode: Mode;
  onSuggest: (text: string) => void;
  onRetry?: () => void;
  showSteps: boolean;
  showRunDetails: boolean;
  progress: Progress | null;
};

const SUGGESTIONS: Record<Mode, string[]> = {
  ask: ["Summarize this page", "What is this page about?", "Find the key numbers here"],
  act: ["Search this site for…", "Fill in the form with…", "Open the pricing page"],
};

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
          {mode === "ask" ? "Ask anything about the page you're on." : "Tell Enki what to do, and it navigates, clicks and types for you."}
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
            <img src={message.screenshot} alt="Screenshot attached" className="mb-2 max-h-28 rounded-md border border-ink-700 object-cover" />
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
      {awaiting && approval && <ApprovalCard label={approval.label} onDecide={approval.resolve} />}
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
                <RotateCw size={11} /> Try again
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
      <span className="truncate">{progress ? describe(progress) : "Working…"}</span>
    </div>
  );
}

function describe(p: Progress): string {
  return `${p.message}${p.step > 0 ? ` · step ${p.step}` : ""} · ${p.elapsed}s`;
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
    ? progress ? describe(progress) : "Working…"
    : tools.length
      ? `${tools.length} ${tools.length === 1 ? "step" : "steps"}${failed ? ` · ${failed} failed` : ""}`
      : "Reasoning";
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
  const outcome = !s ? "Details" : s.outcome === "finished" ? "Done" : s.outcome === "needs_input" ? "Needs your input" : "Could not complete";
  return (
    <details className="group text-xs text-zinc-500">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md py-0.5 pr-1 transition hover:text-zinc-300 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={13} className="transition group-open:rotate-90" />
        {outcome}
      </summary>
      <div className="mt-1.5 flex flex-col gap-1 border-l border-ink-700 pl-3">
        {s && <div>{s.succeeded} tool results successful · {s.failed} failed</div>}
        {s && s.succeeded > 0 && <div>Tool results confirm execution; check the page to verify the intended outcome.</div>}
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

function ApprovalCard({ label, onDecide }: { label: string; onDecide: (ok: boolean) => void }) {
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
      <div className="mb-2 flex items-start gap-2 text-amber-100">
        <ShieldAlert size={14} className="mt-0.5 shrink-0 text-amber-400" />
        <span>Enki wants to <strong>{label}</strong>. This may be hard to undo. Allow?</span>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => onDecide(true)} className="rounded-md bg-zinc-100 px-3 py-1 font-medium text-ink-950 transition hover:bg-zinc-300">Allow</button>
        <button type="button" onClick={() => onDecide(false)} className="rounded-md border border-ink-700 px-3 py-1 text-zinc-200 transition hover:bg-ink-800">Deny</button>
      </div>
    </div>
  );
}
