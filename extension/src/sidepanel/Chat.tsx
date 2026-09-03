import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";
import type { Mode } from "../lib/agent/prompt";
import type { Segment, UiMessage } from "./types";

type Props = {
  messages: UiMessage[];
  approval: { label: string; resolve: (ok: boolean) => void } | null;
  mode: Mode;
  model: string;
  onSuggest: (text: string) => void;
};

const SUGGESTIONS: Record<Mode, string[]> = {
  ask: ["Summarize this page", "What is this page about?", "Explain what I'm looking at", "Find the key numbers here"],
  act: ["Search this site for…", "Fill in the form with…", "Open the pricing page", "Find and click the sign-in button"],
};

export function Chat({ messages, approval, mode, model, onSuggest }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, approval]);

  if (!messages.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <div>
          <div className="text-lg font-semibold">Hi, I'm Enki.</div>
          <div className="mt-1 text-sm text-zinc-400">
            {mode === "ask"
              ? "Ask me anything about the page you're on."
              : "Tell me what to do on this page and I'll navigate, click and type for you."}
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {SUGGESTIONS[mode].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggest(s)}
              className="rounded-full border border-ink-700 bg-ink-900 px-3 py-1 text-xs text-zinc-300 transition hover:border-enki-500/50 hover:text-zinc-100"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-zinc-500">{model}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      <div className="flex flex-col gap-4">
        {messages.map((m) => (
          <MessageView key={m.id} message={m} approval={approval} />
        ))}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}

function MessageView({ message, approval }: { message: UiMessage; approval: Props["approval"] }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-enki-600/25 px-3 py-2 text-sm text-zinc-100">
          {message.screenshot && (
            <img
              src={message.screenshot}
              alt="Screenshot attached"
              className="mb-2 max-h-28 rounded-md border border-ink-700 object-cover"
            />
          )}
          <div className="whitespace-pre-wrap">{message.text}</div>
        </div>
      </div>
    );
  }

  const segments = message.segments ?? [];
  const hasContent = segments.some((s) => s.kind !== "text" || s.text);
  return (
    <div className="flex flex-col gap-2 text-sm">
      {message.thinking && <Thinking text={message.thinking} streaming={!!message.streaming && !hasContent} />}
      {segments.map((s, i) => {
        if (s.kind === "text") {
          if (!s.text) return null;
          const last = i === segments.length - 1;
          return (
            <div key={i} className={`md ${message.streaming && last ? "cursor-blink" : ""}`}>
              <Markdown>{s.text}</Markdown>
            </div>
          );
        }
        return (
          <div key={s.id} className="flex flex-col gap-1">
            <ToolChip seg={s} />
            {s.status === "awaiting" && approval && <ApprovalCard label={approval.label} onDecide={approval.resolve} />}
          </div>
        );
      })}
      {message.streaming && !hasContent && !message.thinking && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 size={13} className="animate-spin" /> Thinking…
        </div>
      )}
      {message.error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="break-words">{message.error}</span>
        </div>
      )}
      {message.note && <div className="text-xs text-zinc-500">{message.note}</div>}
    </div>
  );
}

function Thinking({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs text-zinc-500">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 hover:text-zinc-300">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {streaming ? <Loader2 size={11} className="animate-spin" /> : null}
        Reasoning
      </button>
      {open && <div className="mt-1 whitespace-pre-wrap border-l-2 border-ink-700 pl-2 text-zinc-400">{text}</div>}
    </div>
  );
}

function ToolChip({ seg }: { seg: Extract<Segment, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const icon =
    seg.status === "running" ? (
      <Loader2 size={12} className="animate-spin text-enki-400" />
    ) : seg.status === "awaiting" ? (
      <ShieldAlert size={12} className="text-amber-400" />
    ) : seg.status === "done" ? (
      <Check size={12} className="text-enki-400" />
    ) : seg.status === "declined" ? (
      <Ban size={12} className="text-zinc-400" />
    ) : (
      <X size={12} className="text-red-400" />
    );
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900/70">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-zinc-300"
      >
        {icon}
        <span className="truncate">{seg.label}</span>
        {seg.output !== undefined && (
          <span className="ml-auto text-zinc-600">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
        )}
      </button>
      {open && seg.output !== undefined && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-ink-700 px-2.5 py-2 text-[11px] leading-snug text-zinc-400">
          {seg.output}
        </pre>
      )}
    </div>
  );
}

function ApprovalCard({ label, onDecide }: { label: string; onDecide: (ok: boolean) => void }) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
      <div className="mb-2 flex items-start gap-2 text-amber-100">
        <ShieldAlert size={14} className="mt-0.5 shrink-0 text-amber-400" />
        <span>
          Enki wants to <strong>{label}</strong>. This may be hard to undo. Allow?
        </span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onDecide(true)}
          className="rounded-md bg-enki-500 px-3 py-1 font-medium text-ink-950 transition hover:bg-enki-400"
        >
          Allow
        </button>
        <button
          type="button"
          onClick={() => onDecide(false)}
          className="rounded-md border border-ink-700 px-3 py-1 text-zinc-200 transition hover:bg-ink-800"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
