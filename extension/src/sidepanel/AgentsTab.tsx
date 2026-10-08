/**
 * Settings → Agentes (Receive tabs, 0.9), after Ink's mocks 01-settings-agentes and 05-parear-agente.
 * The service worker does the work (lib/a2a/receiver.ts); this view shows its state from storage and
 * sends requests. Changes apply at once, not through Settings' Save. Agent names come from the agent:
 * plain text only.
 */
import { useEffect, useState } from "react";
import { Copy, Loader2, Plus, X } from "lucide-react";
import { AGENT_COLORS, formatWhen } from "../lib/a2a/policy.js";
import { DEFAULT_AGENT_SETTINGS, K, request, type AgentRecord, type AgentSettings, type LogEntry, type PairingView } from "../lib/a2a/store";

const btn = "rounded-md border border-ink-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-ink-800 hover:text-zinc-100 disabled:opacity-50";
const primary = "rounded-md bg-enki-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-40";

export function AgentChip({ name, color }: { name: string; color: string }) {
  const c = (AGENT_COLORS as Record<string, string>)[color] ?? AGENT_COLORS.blue;
  return (
    <span className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: `${c}26`, color: c }}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c }} />
      <span className="truncate">{name}</span>
    </span>
  );
}

const OUTCOME: Record<LogEntry["outcome"], string> = { pending: "aguardando", accepted: "aceito", declined: "recusado", rejected: "rejeitado", dropped: "descartado" };
const REASON: Record<string, string> = {
  too_large: "grande demais", malformed: "formato inválido", wrong_alg: "formato desconhecido ou sem criptografia", wrong_mailbox: "endereçado a outro",
  unknown_sender: "chave desconhecida", bad_signature: "assinatura inválida", decrypt_failed: "não decifrou", bad_frame: "quadro inválido",
  malformed_frame: "quadro inválido", expired: "mais de 10 min", from_the_future: "data no futuro", replay: "repetido", invalid_bundle: "conteúdo inválido",
  rate_limited: "mais de 5 por hora", too_many_pending: "3 avisos já pendentes", url_not_allowed: "link não permitido",
  shield_blocked: "link bloqueado pelo Shield", shield_unavailable: "Shield não respondeu",
};

export function AgentsTab() {
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_AGENT_SETTINGS);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pairing, setPairing] = useState<PairingView | null>(null);
  const [dialog, setDialog] = useState(false);
  const [relay, setRelay] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    const load = async () => {
      const local = await chrome.storage.local.get([K.settings, K.agents, K.log]);
      const s = { ...DEFAULT_AGENT_SETTINGS, ...(local[K.settings] ?? {}) } as AgentSettings;
      setSettings(s);
      setRelay((r) => r || s.relay);
      setAgents((local[K.agents] as AgentRecord[]) ?? []);
      setLog((local[K.log] as LogEntry[]) ?? []);
      setPairing(((await chrome.storage.session.get(K.pairing))[K.pairing] as PairingView) ?? null);
    };
    void load();
    const onChange = (_c: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "local" || area === "session") void load(); };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const call = async (msg: Parameters<typeof request>[0]) => {
    setError("");
    const r = await request(msg);
    if (!r.ok) setError(r.error);
    return r;
  };

  const toggle = () => void call({ type: "agents:set", settings: { enabled: !settings.enabled } });
  const saveRelay = () => void call({ type: "agents:set", settings: { relay } });
  const startPairing = async () => {
    setBusy(true);
    const r = await call({ type: "agents:pair-start" });
    setBusy(false);
    if (r.ok) setDialog(true);
  };
  const canPair = settings.enabled && !!settings.relay;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-100">Agentes</h2>
        <p className="mt-1 text-xs text-zinc-400">Receba pacotes de abas de agentes pareados (Helm, n8n, etc.). Desligado por padrão — nada chega até você ativar e parear.</p>
      </div>

      <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-100">Receber abas de agentes</div>
            <div className="text-[11px] text-zinc-400">Consulta o relay só quando ligado. Pacotes sem chave válida são ignorados.</div>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{settings.enabled ? "Ligado" : "Desligado"}</span>
          <button
            type="button" role="switch" aria-checked={settings.enabled} aria-label="Receber abas de agentes" onClick={toggle}
            className={`relative h-5 w-9 shrink-0 rounded-full transition ${settings.enabled ? "bg-enki-500" : "bg-ink-700"}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-zinc-100 transition-all ${settings.enabled ? "left-[18px]" : "left-0.5"}`} />
          </button>
        </div>
        <label className="mt-3 block text-[11px] text-zinc-400" htmlFor="agents-relay">Relay</label>
        <div className="mt-1 flex gap-2">
          <input
            id="agents-relay" value={relay} onChange={(e) => setRelay(e.target.value)} placeholder="https://relay.exemplo.org" spellCheck={false}
            className="w-full rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-enki-500/60"
          />
          <button type="button" className={btn} onClick={saveRelay} disabled={relay.trim() === settings.relay}>Salvar</button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">O relay só guarda texto cifrado até a entrega ou por 10 minutos. Precisa ser https://.</p>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}

      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Agentes pareados</h3>
        <button type="button" className={`${primary} inline-flex items-center gap-1`} disabled={!canPair || busy} onClick={() => void startPairing()} title={canPair ? "" : "Ligue o interruptor e configure o relay"}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Parear agente
        </button>
      </div>

      <div className="divide-y divide-ink-700 rounded-xl border border-ink-700 bg-ink-900/60">
        {agents.length === 0 && <p className="px-3 py-3 text-xs text-zinc-500">Nenhum agente pareado.</p>}
        {agents.map((a) => (
          <div key={a.id} className="flex items-center gap-3 px-3 py-2.5" data-agent={a.name}>
            <AgentChip name={a.name} color={a.color} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-zinc-100">{a.name}</div>
              <div className="text-[11px] text-zinc-500">Último pacote · {formatWhen(a.lastPacketAt)}</div>
            </div>
            {confirmUnpair === a.id ? (
              <span className="flex gap-1">
                <button type="button" className="rounded-md border border-red-500/50 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10" onClick={() => { setConfirmUnpair(null); void call({ type: "agents:unpair", id: a.id }); }}>Confirmar</button>
                <button type="button" className={btn} onClick={() => setConfirmUnpair(null)}>Não</button>
              </span>
            ) : (
              <button type="button" className="rounded-md border border-red-500/50 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10" onClick={() => setConfirmUnpair(a.id)}>Desparear</button>
            )}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-zinc-500">Cada agente tem chave própria no perfil. Desparear apaga só a dele. Quem mandou nunca fica sabendo se você aceitou ou abriu.</p>

      <div>
        <button type="button" className="text-[11px] text-zinc-400 underline" onClick={() => setShowLog(!showLog)} aria-expanded={showLog}>
          Registro dos últimos pacotes ({log.length}) — só neste computador
        </button>
        {showLog && (
          <div className="mt-2 space-y-1">
            {log.map((e, i) => (
              <div key={i} className="flex gap-2 text-[11px] text-zinc-400" data-log={e.outcome} data-reason={e.reason ?? ""}>
                <span className="shrink-0 text-zinc-500">{formatWhen(e.at)}</span>
                <span className="shrink-0">{agents.find((a) => a.id === e.agentId)?.name ?? "—"}</span>
                <span className="min-w-0 flex-1 truncate">{e.title ?? ""}</span>
                <span className="shrink-0">{OUTCOME[e.outcome]}{e.reason ? ` · ${REASON[e.reason] ?? e.reason}` : ""}</span>
              </div>
            ))}
            {log.length > 0 && <button type="button" className={btn} onClick={() => void call({ type: "agents:clear-log" })}>Limpar registro</button>}
          </div>
        )}
      </div>

      {dialog && <PairingDialog view={pairing} onClose={() => setDialog(false)} onError={setError} />}
    </div>
  );
}

/** Ink's 05-parear-agente: the one-time code with its countdown, then the agent's name and complete fingerprint. */
function PairingDialog({ view, onClose, onError }: { view: PairingView | null; onClose: () => void; onError: (e: string) => void }) {
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 500);
    // While the dialog is open, ask the worker to look at the pairing mailbox every 2 s.
    const poll = setInterval(() => void request({ type: "agents:pair-poll" }), 2000);
    void request({ type: "agents:pair-poll" });
    return () => { clearInterval(tick); clearInterval(poll); };
  }, []);

  const cancel = async () => { await request({ type: "agents:pair-cancel" }); onClose(); };
  const confirm = async () => {
    const r = await request({ type: "agents:pair-confirm" });
    if (!r.ok) onError(r.error);
    onClose();
  };
  const left = view ? Math.max(0, view.exp - now) : 0;
  const expired = !!view && left === 0 && view.step !== "confirm";
  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="pair-title" className="w-full max-w-sm overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-ink-700 px-4 py-3">
          <h3 id="pair-title" className="flex-1 text-sm font-semibold text-zinc-100">Parear agente</h3>
          <button type="button" aria-label="Fechar" className="text-zinc-500 hover:text-zinc-200" onClick={() => void cancel()}><X size={16} /></button>
        </div>
        <div className="space-y-3 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">1 · Cole este código no agente</div>
          <div className="rounded-xl border border-ink-700 bg-ink-950 px-3 py-3 text-center">
            <div className="flex items-center justify-center gap-2">
              <span data-testid="pair-code" className="select-all font-mono text-2xl font-semibold tracking-wider text-enki-400">{view?.code ?? "…"}</span>
              {view && (
                <button type="button" className="text-zinc-500 hover:text-zinc-200" aria-label="Copiar código" onClick={() => void navigator.clipboard.writeText(view.code).then(() => setCopied(true))}>
                  <Copy size={14} />
                </button>
              )}
            </div>
            <div className="mt-1 text-[11px] text-zinc-400">
              {expired ? "código expirado" : <><b className="text-zinc-200">expira em {mmss}</b> · vale uma vez só{copied ? " · copiado" : ""}</>}
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded bg-ink-700"><div className="h-full bg-enki-500 transition-all" style={{ width: `${(left / 300000) * 100}%` }} /></div>
          </div>

          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">2 · Confira antes de confirmar</div>
          <div className="rounded-xl border border-enki-500/30 bg-enki-500/5 px-3 py-3">
            {view?.step === "confirm" ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
                  <AgentChip name={view.name} color={view.color} />
                  <span>O agente <b className="text-zinc-100">{view.name}</b> usou o código e quer parear.</span>
                </div>
                <div className="mt-3 text-[11px] text-zinc-400">Impressão da chave</div>
                <div data-testid="pair-fingerprint" className="mt-1 inline-block rounded-md border border-ink-700 bg-ink-950 px-2.5 py-1.5 font-mono text-base font-semibold tracking-wider text-zinc-100">{view.fingerprint}</div>
                <p className="mt-2 text-[11px] text-zinc-500">Tem que ser igual à que o {view.name} mostra, inteira. Se for diferente, clique em Cancelar.</p>
              </>
            ) : view?.step === "failed" ? (
              <p className="text-xs text-red-300">{view.error}. O código foi gasto; feche e gere outro.</p>
            ) : (
              <p className="flex items-center gap-2 text-xs text-zinc-400">
                {!expired && <Loader2 size={12} className="animate-spin" />}
                {expired ? "Ninguém usou o código a tempo. Feche e gere outro." : view?.step === "offered" ? "O agente respondeu; aguardando as chaves dele…" : "Aguardando o agente usar o código…"}
              </p>
            )}
          </div>
          <p className="text-[11px] text-zinc-500">O Enki nunca aceita um pareamento sozinho. Nada é pareado até você clicar em Confirmar.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-ink-700 px-4 py-3">
          <button type="button" className={btn} onClick={() => void cancel()}>Cancelar</button>
          <button type="button" className={primary} disabled={view?.step !== "confirm"} onClick={() => void confirm()}>Confirmar</button>
        </div>
      </div>
    </div>
  );
}
