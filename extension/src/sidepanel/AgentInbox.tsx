/**
 * Receive tabs (0.9) in the side panel, after Ink's mocks 02-aviso-painel and 04-cartao-resumo:
 * the notice for each waiting packet (Aceitar / Recusar) and the summary card of an accepted one.
 *
 * Everything shown here came from an agent and is untrusted plain text, rendered as React text
 * (textContent), never as HTML or Markdown. None of it is added to the conversation or handed to
 * the assistant or Act. Nothing is shown in incognito windows.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { AGENT_COLORS } from "../lib/a2a/policy.js";
import { K, request, type AgentRecord, type Notice, type SummaryCard } from "../lib/a2a/store";
import { AgentChip } from "./AgentsTab";

const shortPath = (url: string) => {
  try {
    const u = new URL(url);
    const rest = u.pathname === "/" ? "" : u.pathname;
    return rest.length > 28 ? rest.slice(0, 27) + "…" : rest;
  } catch { return ""; }
};

export function AgentInbox() {
  const [pending, setPending] = useState<Notice[]>([]);
  const [cards, setCards] = useState<SummaryCard[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [windowId, setWindowId] = useState<number | undefined>(undefined);
  const [incognito, setIncognito] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const override = Number(new URLSearchParams(location.search).get("window"));
    (override ? chrome.windows.get(override) : chrome.windows.getCurrent()).then((w) => { setWindowId(w.id); setIncognito(w.incognito); }, () => setIncognito(false));
    const load = async () => {
      const v = await chrome.storage.local.get([K.pending, K.cards, K.agents]);
      setPending((v[K.pending] as Notice[]) ?? []);
      setCards((v[K.cards] as SummaryCard[]) ?? []);
      setAgents((v[K.agents] as AgentRecord[]) ?? []);
    };
    void load();
    const onChange = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && (K.pending in c || K.cards in c || K.agents in c)) void load();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  if (incognito || (!pending.length && !cards.length)) return null;
  const agentOf = (id: string) => agents.find((a) => a.id === id);
  const act = async (msg: Parameters<typeof request>[0]) => {
    setError("");
    const r = await request(msg);
    if (!r.ok) setError(r.error);
  };

  return (
    <div className="mx-3 mb-2 max-h-[55%] space-y-3 overflow-y-auto" aria-label="Pacotes de agentes">
      {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}
      {pending.map((n) => {
        const agent = agentOf(n.agentId);
        if (!agent) return null;
        const color = AGENT_COLORS[agent.color] ?? AGENT_COLORS.blue;
        return (
          <div key={n.id} data-notice={n.id}>
            <p className="mb-1.5 text-center text-[11px] text-zinc-500">Pacote novo de um agente pareado</p>
            <article className="rounded-xl border border-ink-700 bg-ink-900 px-3 py-3" style={{ borderLeft: `3px solid ${color}` }}>
              <div className="flex items-center gap-2">
                <AgentChip name={agent.name} color={agent.color} />
                <span className="text-[11px] text-zinc-500">quer abrir um grupo de abas</span>
              </div>
              <h2 className="mt-2 break-words text-base font-semibold text-zinc-100">{n.title}</h2>
              <p className="text-[11px] text-zinc-400">{n.links.length} {n.links.length === 1 ? "link" : "links"} · só http(s) · texto puro</p>
              <ol className="mt-2 space-y-1.5">
                {n.links.map((l, i) => (
                  <li key={l.url} className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-800/60 px-2 py-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-ink-700 text-[10px] font-semibold text-enki-400">{i + 1}</span>
                    <span className="min-w-0 truncate font-mono text-xs text-zinc-200" title={l.url}>
                      {l.host}<span className="text-zinc-500">{shortPath(l.url)}</span>
                    </span>
                    {l.idn && <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] text-amber-300" title="Domínio internacional, mostrado em punycode">IDN</span>}
                  </li>
                ))}
              </ol>
              {!n.shieldChecked && <p className="mt-2 text-[11px] text-amber-300">O Enki Shield não está disponível aqui: estes links não foram verificados.</p>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="rounded-lg bg-enki-500 py-2 text-sm font-semibold text-ink-950 hover:brightness-110" onClick={() => void act({ type: "agents:accept", id: n.id, windowId })}>Aceitar</button>
                <button type="button" className="rounded-lg border border-ink-700 py-2 text-sm text-zinc-300 hover:bg-ink-800" onClick={() => void act({ type: "agents:decline", id: n.id })}>Recusar</button>
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">Quem mandou não fica sabendo se você aceitar ou recusar. Nada abre até o Aceitar.</p>
            </article>
          </div>
        );
      })}
      {cards.map((c) => {
        const agent = agentOf(c.agentId);
        if (!agent) return null;
        return (
          <div key={c.id} data-card={c.id}>
            <p className="mb-1.5 text-center text-[11px] text-zinc-500">Grupo aberto · <span className="font-semibold text-emerald-400">{c.tabs} {c.tabs === 1 ? "aba" : "abas"} na página de espera</span></p>
            <article className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900" aria-label="Cartão de dados">
              <div className="flex items-center justify-between bg-purple-500/10 px-3 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wide text-purple-300">▢ Dado · resumo</span>
                <span className="flex items-center gap-2 text-[10px] text-zinc-500">não confiável
                  <button type="button" aria-label="Fechar cartão" className="hover:text-zinc-200" onClick={() => void act({ type: "agents:dismiss-card", id: c.id })}><X size={12} /></button>
                </span>
              </div>
              <div className="px-3 py-3">
                <AgentChip name={agent.name} color={agent.color} />
                <h2 className="mt-2 break-words text-base font-semibold text-zinc-100">{c.title}</h2>
                {c.summary && <p data-testid="summary" className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-300">{c.summary}</p>}
                <ul className="mt-2 space-y-1">
                  {c.hosts.map((h, i) => <li key={i} className="rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1 font-mono text-xs text-zinc-200">• {h}</li>)}
                </ul>
              </div>
            </article>
            <p className="mt-1.5 text-[11px] text-zinc-500">O resumo só vai pro assistente se você pedir. Cada aba fica em hold.html até você clicar em Abrir.</p>
          </div>
        );
      })}
    </div>
  );
}
