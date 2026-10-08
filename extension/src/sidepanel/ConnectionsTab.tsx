/**
 * Settings → Connections: apps Enki can use through MCP, and saved tasks run with /name.
 * Changes here are saved at once (signing in is a live action), not through Settings' Save.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Plug, Plus, Trash2 } from "lucide-react";
import { PRESETS, connect, disconnect, loadConnections, onConnectionsChange, saveConnections, type Connection, type Preset } from "../lib/connectors";
import { handle, loadTasks, saveTasks, type SavedTask } from "../lib/shortcuts";

const inputCls = "w-full rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-enki-500/60";
const btn = "rounded-md border border-ink-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-ink-800 hover:text-zinc-100 disabled:opacity-50";
const uid = () => Math.random().toString(36).slice(2, 10);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}

export function ConnectionsTab() {
  const [apps, setApps] = useState<Connection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [custom, setCustom] = useState<{ name: string; url: string; auth: Connection["auth"]; token: string } | null>(null);
  const [tokenFor, setTokenFor] = useState<{ preset: Preset; token: string } | null>(null);

  useEffect(() => {
    void loadConnections().then(setApps);
    return onConnectionsChange(setApps);
  }, []);

  const store = async (next: Connection[]) => { setApps(next); await saveConnections(next); };
  const update = async (c: Connection) => store((await loadConnections()).map((x) => (x.id === c.id ? c : x)));

  const add = async (name: string, url: string, auth: Connection["auth"], token?: string) => {
    const conn: Connection = { id: uid(), name: name.trim() || new URL(url).host, url: url.trim(), auth, enabled: true, tools: [] };
    await store([...(await loadConnections()), conn]);
    await run(conn, token);
  };

  const run = async (conn: Connection, token?: string) => {
    setBusy(conn.id);
    try { await update(await connect(conn, { interactive: true, token })); }
    finally { setBusy(null); }
  };

  const remove = async (conn: Connection) => {
    await disconnect(conn);
    await store((await loadConnections()).filter((c) => c.id !== conn.id));
  };

  return (
    <>
      <Section title="Apps">
        <p className="text-xs text-zinc-400">
          Connect an app and Enki can use it for you: ask “@jira create a ticket for this bug”. Enki reads freely; anything that changes your data waits for your OK, unless you allow that tool below. You sign in on the app's own page; Enki keeps only the access it grants, on this device.
        </p>
        {apps.map((c) => (
          <div key={c.id} className="rounded-lg border border-ink-700 bg-ink-900/60">
            <div className="flex items-center gap-2 px-2.5 py-2">
              <button type="button" onClick={() => setOpen(open === c.id ? null : c.id)} className="text-zinc-400" aria-label={`Show ${c.name}'s tools`} aria-expanded={open === c.id}>
                {open === c.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <span className={`h-2 w-2 shrink-0 rounded-full ${c.status === "connected" ? "bg-emerald-400" : c.status === "error" ? "bg-red-400" : "bg-zinc-500"}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-zinc-100">{c.name} <span className="text-xs text-zinc-500">@{handle(c.name)}</span></div>
                <div className="truncate text-[11px] text-zinc-500">{c.status === "connected" ? `${c.tools.length} tools` : c.error ?? "Not connected"}</div>
              </div>
              <label className="flex items-center gap-1 text-[11px] text-zinc-400" title="Offer this app's tools to Enki">
                <input type="checkbox" checked={c.enabled} onChange={(e) => void update({ ...c, enabled: e.target.checked })} /> On
              </label>
              <button type="button" className={btn} disabled={busy === c.id} onClick={() => void run(c)}>
                {busy === c.id ? <Loader2 size={12} className="animate-spin" /> : c.status === "connected" ? "Refresh" : "Connect"}
              </button>
              <button type="button" className="text-zinc-500 hover:text-red-300" title={`Remove ${c.name}`} onClick={() => void remove(c)}><Trash2 size={14} /></button>
            </div>
            {open === c.id && (
              <ul className="space-y-1 border-t border-ink-700 px-3 py-2">
                {c.tools.length === 0 && <li className="text-xs text-zinc-500">No tools yet. Connect first.</li>}
                {c.tools.map((t) => (
                  <li key={t.name} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 rounded px-1 text-[10px] ${t.readOnly ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>{t.readOnly ? "read" : "write"}</span>
                    <span className="min-w-0 flex-1"><span className="text-zinc-200">{t.title}</span> <span className="text-zinc-500">{t.description.slice(0, 120)}</span></span>
                    {!t.readOnly && (
                      <label className="flex shrink-0 items-center gap-1 text-[11px] text-zinc-400" title="Run this tool without the confirmation card">
                        <input type="checkbox" checked={!!t.allowed} onChange={(e) => void update({ ...c, tools: c.tools.map((x) => (x.name === t.name ? { ...x, allowed: e.target.checked } : x)) })} /> no asking
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.filter((p) => !apps.some((a) => a.url === p.url)).map((p) => (
            <button key={p.id} type="button" title={p.hint} className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-2 text-left text-xs text-zinc-300 hover:bg-ink-800"
              onClick={() => (p.auth === "token" ? setTokenFor({ preset: p, token: "" }) : void add(p.name, p.url, p.auth))}>
              <Plug size={13} className="shrink-0 text-zinc-500" /><span className="truncate">{p.name}</span>
            </button>
          ))}
          <button type="button" className="flex items-center gap-1.5 rounded-lg border border-dashed border-ink-700 px-2.5 py-2 text-xs text-zinc-400 hover:bg-ink-800" onClick={() => setCustom({ name: "", url: "", auth: "oauth", token: "" })}>
            <Plus size={13} /> Other MCP server
          </button>
        </div>

        {tokenFor && (
          <div className="space-y-2 rounded-lg border border-ink-700 p-2.5">
            <p className="text-xs text-zinc-400">{tokenFor.preset.hint}</p>
            <input type="password" autoComplete="off" placeholder="Paste the token" aria-label={`${tokenFor.preset.name} token`} value={tokenFor.token} onChange={(e) => setTokenFor({ ...tokenFor, token: e.target.value })} className={inputCls} />
            <div className="flex justify-end gap-2">
              <button type="button" className={btn} onClick={() => setTokenFor(null)}>Cancel</button>
              <button type="button" className={btn} disabled={!tokenFor.token.trim()} onClick={() => { const t = tokenFor; setTokenFor(null); void add(t.preset.name, t.preset.url, "token", t.token); }}>Connect</button>
            </div>
          </div>
        )}

        {custom && (
          <div className="space-y-2 rounded-lg border border-ink-700 p-2.5">
            <input placeholder="Name (e.g. Jira)" aria-label="Connection name" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} className={inputCls} />
            <input placeholder="https://… MCP server URL" aria-label="MCP server URL" value={custom.url} onChange={(e) => setCustom({ ...custom, url: e.target.value })} className={inputCls} />
            <select aria-label="Sign-in" value={custom.auth} onChange={(e) => setCustom({ ...custom, auth: e.target.value as Connection["auth"] })} className={inputCls}>
              <option value="oauth">Sign in on the app's page (OAuth)</option>
              <option value="token">Access token</option>
              <option value="none">No sign-in</option>
            </select>
            {custom.auth === "token" && <input type="password" autoComplete="off" placeholder="Paste the token" aria-label="Access token" value={custom.token} onChange={(e) => setCustom({ ...custom, token: e.target.value })} className={inputCls} />}
            <div className="flex justify-end gap-2">
              <button type="button" className={btn} onClick={() => setCustom(null)}>Cancel</button>
              <button type="button" className={btn} disabled={!/^https?:\/\//.test(custom.url.trim())}
                onClick={() => { const c = custom; setCustom(null); void add(c.name, c.url, c.auth, c.auth === "token" ? c.token : undefined); }}>Add and connect</button>
            </div>
          </div>
        )}
      </Section>

      <SavedTasks />
    </>
  );
}

function SavedTasks() {
  const [tasks, setTasks] = useState<SavedTask[]>([]);
  const [draft, setDraft] = useState<SavedTask | null>(null);
  useEffect(() => { void loadTasks().then(setTasks); }, []);
  const store = async (next: SavedTask[]) => { setTasks(next); await saveTasks(next); };
  return (
    <Section title="Saved tasks">
      <p className="text-xs text-zinc-400">
        A request you repeat, run by typing <code className="text-zinc-300">/name</code> in the message box, plus anything you add after it. In Act mode it works on whatever site is open, apps without a connection included.
      </p>
      {tasks.map((t) => (
        <div key={t.id} className="flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-900/60 px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-zinc-100">/{handle(t.name)} <span className="text-[11px] text-zinc-500">{t.mode === "act" ? "Act" : "Ask"}</span></div>
            <div className="line-clamp-2 text-[11px] text-zinc-500">{t.prompt}</div>
          </div>
          <button type="button" className="text-zinc-500 hover:text-zinc-200" onClick={() => setDraft(t)}>Edit</button>
          <button type="button" className="text-zinc-500 hover:text-red-300" title={`Delete /${handle(t.name)}`} onClick={() => void store(tasks.filter((x) => x.id !== t.id))}><Trash2 size={14} /></button>
        </div>
      ))}
      {draft ? (
        <div className="space-y-2 rounded-lg border border-ink-700 p-2.5">
          <input placeholder="Name (e.g. standup)" aria-label="Task name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputCls} />
          <select aria-label="Task mode" value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as SavedTask["mode"] })} className={inputCls}>
            <option value="ask">Ask: read and answer</option>
            <option value="act">Act: navigate, click and type</option>
          </select>
          <textarea placeholder="What Enki should do, e.g. “Open my Jira board and list what is assigned to me”" aria-label="Task prompt" rows={3} value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} className={inputCls} />
          <div className="flex justify-end gap-2">
            <button type="button" className={btn} onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className={btn} disabled={!handle(draft.name) || !draft.prompt.trim()}
              onClick={() => { const d = draft; setDraft(null); void store(tasks.some((t) => t.id === d.id) ? tasks.map((t) => (t.id === d.id ? d : t)) : [...tasks, d]); }}>
              <Check size={12} className="mr-1 inline" />Save task
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={btn} onClick={() => setDraft({ id: uid(), name: "", prompt: "", mode: "act" })}><Plus size={12} className="mr-1 inline" />New task</button>
      )}
    </Section>
  );
}
