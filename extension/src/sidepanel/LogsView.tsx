import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, ClipboardCopy, Trash2 } from "lucide-react";
import { clearLogs, getLogs, onLogs, type LogEntry } from "../lib/debug";
import { diagnosticReport } from "../lib/diagnostics";
import type { Settings } from "../lib/settings";

const LEVEL_STYLE: Record<LogEntry["level"], string> = {
  info: "text-zinc-400",
  warn: "text-amber-400",
  error: "text-red-400",
};

export function LogsView({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const [entries, setEntries] = useState<LogEntry[]>(getLogs());
  const [copied, setCopied] = useState(false);

  useEffect(() => onLogs(setEntries), []);

  const copy = async () => {
    try { await navigator.clipboard.writeText(diagnosticReport(settings)); }
    catch {
      const url = URL.createObjectURL(new Blob([diagnosticReport(settings)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = "enki-diagnostics.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-zinc-400 hover:bg-ink-800 hover:text-zinc-100"
          title="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="font-semibold">Logs</span>
        <span className="text-xs text-zinc-500">{entries.length}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={copy}
            title="Copy safe diagnostics"
            className="rounded-md p-1.5 text-zinc-400 hover:bg-ink-800 hover:text-zinc-100"
          >
            <ClipboardCopy size={15} />
          </button>
          <button
            type="button"
            onClick={() => clearLogs()}
            title="Clear"
            className="rounded-md p-1.5 text-zinc-400 hover:bg-ink-800 hover:text-zinc-100"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      {copied && <div className="bg-enki-500/15 px-3 py-1 text-xs text-enki-400">Copied to the clipboard.</div>}

      {entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-zinc-500">
          Nothing logged yet. Send a message and come back — requests, tool calls and errors are recorded here.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 py-2 font-mono text-[11px]">
          {entries.map((e) => (
            <Row key={e.id} entry={e} />
          ))}
        </div>
      )}

      <div className="border-t border-ink-700 px-3 py-2 text-[11px] text-zinc-500">
        Copy exports a safe diagnostic report without page content, URLs, prompts, credentials, or raw errors. The local log view may contain page data.
      </div>
    </div>
  );
}

function Row({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);
  const time = new Date(entry.time).toISOString().slice(11, 23);
  const hasData = entry.data !== undefined;
  return (
    <div className="border-b border-ink-800/60 py-1">
      <button
        type="button"
        disabled={!hasData}
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-1.5 text-left"
      >
        <span className="shrink-0 text-zinc-600">{time}</span>
        <span className={`shrink-0 ${LEVEL_STYLE[entry.level]}`}>{entry.scope}</span>
        <span className="min-w-0 flex-1 break-all text-zinc-300">{entry.message}</span>
        {hasData && (
          <span className="shrink-0 text-zinc-600">
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        )}
      </button>
      {open && hasData && (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-ink-900/80 p-2 text-[10px] leading-snug text-zinc-400">
          {safeStringify(entry.data)}
        </pre>
      )}
    </div>
  );
}

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}
