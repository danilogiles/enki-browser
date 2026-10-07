import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, MoreHorizontal, Trash2 } from "lucide-react";
import logo from "../assets/logo.svg";
import { presetOf, type Settings } from "../lib/settings";
import { isRestrictedUrl } from "../lib/tools/executor";
import type { ChatEntry } from "../lib/history";
import type { TabInfo } from "./types";

/**
 * The panel's only chrome, kept as quiet as Comet's: Enki and the model on the left (a click
 * switches models), a "more" menu on the right with past chats and the actions that used to sit
 * under every reply.
 */
type Props = {
  settings: Settings;
  running: boolean;
  onModel: (model: string) => void;
  onOpenSettings: () => void;
  chats: ChatEntry[];
  currentChat: string | null;
  onNewChat: () => void;
  onOpenChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  canContinue: boolean;
  onContinue: () => void;
  onReadAgain: () => void;
  onCopyDiagnostics: () => void;
  onLogs?: () => void;
  tabs: TabInfo[];
  selectedTab: number | null;
  onSelectTab: (id: number | null) => void;
  usage: { input: number; output: number };
};

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

export function Header(p: Props) {
  const models = usePopover();
  const more = usePopover();
  const [search, setSearch] = useState("");
  const preset = presetOf(p.settings.preset);
  const choices = [...new Set([
    p.settings.model, ...(p.settings.favoriteModels ?? []), p.settings.askModel, p.settings.actModel,
    ...(preset.recommended ?? []).map((r) => r.id),
  ].filter(Boolean))].filter((m) => m.toLowerCase().includes(search.toLowerCase()));
  const short = (m: string) => m.split("/").pop() ?? m;

  return (
    <header className="flex items-center gap-2 px-3 py-2.5">
      <img src={logo} alt="" className="h-5 w-5" />
      <span className="text-sm font-semibold tracking-tight">Enki</span>

      <div ref={models.ref} className="relative min-w-0">
        <button
          type="button"
          disabled={p.running}
          onClick={() => { setSearch(""); models.setOpen(!models.open); }}
          title={`Model: ${p.settings.model} (${preset.label}). Click to switch.`}
          className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-zinc-400 transition hover:bg-ink-800 hover:text-zinc-100 disabled:opacity-60"
        >
          <span className="max-w-[150px] truncate">{short(p.settings.model || p.settings.preset)}</span>
          <ChevronDown size={12} className="shrink-0" />
        </button>
        {p.settings.devMode && p.settings.unfiltered && (
          <span title="Unfiltered: Enki's tone rules are off; the model's policy is the only filter (Settings → Behavior → Developer)."
            className="absolute -right-1 top-1/2 translate-x-full -translate-y-1/2 rounded-full border border-amber-500/40 px-1.5 py-px text-[10px] text-amber-300">
            unfiltered
          </span>
        )}
        {models.open && (
          <Popover className="left-0 w-64">
            <input
              id="model-search"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models"
              aria-label="Search models"
              className="mb-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-enki-500/60"
            />
            <div className="max-h-64 overflow-y-auto">
              {choices.map((m) => (
                <MenuItem key={m} title={m} onClick={() => { p.onModel(m); models.setOpen(false); }}>
                  <span className="min-w-0 flex-1 truncate">{m}</span>
                  {m === p.settings.model && <Check size={13} className="shrink-0 text-enki-400" />}
                </MenuItem>
              ))}
              {!choices.length && <div className="px-2 py-1.5 text-xs text-zinc-500">No matching model.</div>}
            </div>
            <Divider />
            <MenuItem onClick={() => { models.setOpen(false); p.onOpenSettings(); }}>All models and providers…</MenuItem>
          </Popover>
        )}
      </div>

      <div ref={more.ref} className="relative ml-auto">
        <button
          type="button"
          title="More"
          aria-label="More"
          onClick={() => more.setOpen(!more.open)}
          className="rounded-md p-1.5 text-zinc-400 transition hover:bg-ink-800 hover:text-zinc-100"
        >
          <MoreHorizontal size={16} />
        </button>
        {more.open && (
          <Popover className="right-0 w-72">
            <MenuItem title="New chat" onClick={() => { more.setOpen(false); p.onNewChat(); }}>New chat</MenuItem>
            {p.canContinue && <MenuItem onClick={() => { more.setOpen(false); p.onContinue(); }}>Continue safely</MenuItem>}
            {p.canContinue && <MenuItem onClick={() => { more.setOpen(false); p.onReadAgain(); }}>Read page again</MenuItem>}
            {p.chats.length > 0 && (
              <>
                <Divider />
                <div className="px-2 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Recent chats</div>
                <div className="max-h-56 overflow-y-auto">
                  {p.chats.slice(0, 20).map((c) => (
                    <div key={c.id} className="group flex items-center">
                      <MenuItem onClick={() => { more.setOpen(false); p.onOpenChat(c.id); }}>
                        <span className={`min-w-0 flex-1 truncate ${c.id === p.currentChat ? "text-enki-400" : ""}`}>{c.title}</span>
                        <span className="shrink-0 text-[11px] text-zinc-500">{ago(c.updatedAt)}</span>
                      </MenuItem>
                      <button type="button" title="Delete chat" aria-label={`Delete chat ${c.title}`} onClick={() => p.onDeleteChat(c.id)}
                        className="invisible shrink-0 rounded p-1 text-zinc-500 hover:text-red-300 group-hover:visible">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
            <Divider />
            <label htmlFor="controlled-tab" className="block px-2 pb-1 text-[11px] text-zinc-500">Controlled tab {p.running ? "(locked for this task)" : ""}</label>
            <select id="controlled-tab" disabled={p.running} value={p.selectedTab ?? ""} onChange={(e) => p.onSelectTab(e.target.value ? Number(e.target.value) : null)}
              className="mx-2 mb-1 w-[calc(100%-1rem)] min-w-0 rounded-md border border-ink-700 bg-ink-950 p-1.5 text-xs text-zinc-200">
              <option value="">Active tab when a task starts</option>
              {p.selectedTab !== null && !p.tabs.some((t) => t.id === p.selectedTab) && <option value={p.selectedTab}>Selected tab was closed</option>}
              {p.tabs.map((t) => <option value={t.id} key={t.id}>{t.title || t.url}{isRestrictedUrl(t.url) ? " (internal page — navigate only)" : ""}</option>)}
            </select>
            <Divider />
            <MenuItem onClick={() => { more.setOpen(false); p.onCopyDiagnostics(); }}>Copy diagnostics</MenuItem>
            {p.onLogs && <MenuItem title="Logs" onClick={() => { more.setOpen(false); p.onLogs?.(); }}>Logs</MenuItem>}
            {p.usage.input + p.usage.output > 0 && (
              <div className="px-2 pt-1 text-[11px] text-zinc-500">This chat: {fmt(p.usage.input)} in / {fmt(p.usage.output)} out tokens</div>
            )}
          </Popover>
        )}
      </div>
    </header>
  );
}

function Popover({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div role="menu" className={`absolute top-full z-30 mt-1 rounded-xl border border-ink-700 bg-ink-900 p-1.5 shadow-[0_12px_40px_rgb(0_0_0/0.35)] ${className}`}>
      {children}
    </div>
  );
}

function MenuItem({ title, onClick, children }: { title?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" title={title} onClick={onClick}
      className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-ink-800">
      {children}
    </button>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-ink-700" />;
}

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
