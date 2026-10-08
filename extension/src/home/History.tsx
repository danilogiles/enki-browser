import { useEffect, useState } from "react";
import { MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Trash2 } from "lucide-react";
import { deleteChat, listChats, type ChatEntry } from "../lib/history";
import { loadSettings } from "../lib/settings";

/**
 * Enki Home's conversation list, on the left as in Comet and Perplexity: the saved chats, newest
 * first and grouped by day, a New chat button, and a way to fold it out of the way. It reads the
 * same sealed history the side panel does, so a chat started anywhere shows up here, live.
 *
 * Folding is remembered per browser (localStorage, only a convenience: without it the list just
 * starts open on wide windows and folded on narrow ones).
 */

type Lang = "pt" | "es" | "en";
const TEXT = {
  pt: { title: "Conversas", new: "Nova conversa", fold: "Recolher conversas", unfold: "Mostrar conversas", empty: "Suas conversas aparecem aqui.", off: "O histórico está desligado.", offHint: "Ative “Salvar conversas” nas Configurações do Enki para ver suas conversas aqui.", remove: "Apagar conversa", confirm: "Apagar esta conversa? Não dá para desfazer.", groups: ["Hoje", "Ontem", "Últimos 7 dias", "Mais antigas"] },
  es: { title: "Conversaciones", new: "Nueva conversación", fold: "Ocultar conversaciones", unfold: "Mostrar conversaciones", empty: "Tus conversaciones aparecen aquí.", off: "El historial está desactivado.", offHint: "Activa “Guardar conversaciones” en la Configuración de Enki para verlas aquí.", remove: "Borrar conversación", confirm: "¿Borrar esta conversación? No se puede deshacer.", groups: ["Hoy", "Ayer", "Últimos 7 días", "Anteriores"] },
  en: { title: "Conversations", new: "New chat", fold: "Hide conversations", unfold: "Show conversations", empty: "Your conversations show up here.", off: "History is off.", offHint: "Turn on “Save conversations” in Enki's Settings to see your chats here.", remove: "Delete chat", confirm: "Delete this chat? This cannot be undone.", groups: ["Today", "Yesterday", "Previous 7 days", "Older"] },
} as const satisfies Record<Lang, unknown>;
const lang: Lang = navigator.language.startsWith("pt") ? "pt" : navigator.language.startsWith("es") ? "es" : "en";
const t = TEXT[lang];

const FOLD_KEY = "enki:home-history-folded";
function readFolded(): boolean {
  try {
    const v = localStorage.getItem(FOLD_KEY);
    if (v !== null) return v === "1";
  } catch { /* storage unavailable: fall back to the window width */ }
  return window.innerWidth < 900;
}
function writeFolded(folded: boolean) {
  try { localStorage.setItem(FOLD_KEY, folded ? "1" : "0"); } catch { /* not worth failing over */ }
}

/** Today, yesterday, the past week, older: the groups people scan a history by. */
function groupOf(updatedAt: number, now = new Date()): number {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (updatedAt >= day) return 0;
  if (updatedAt >= day - 86_400_000) return 1;
  if (updatedAt >= day - 7 * 86_400_000) return 2;
  return 3;
}

export function History({ activeId, onOpen, onNew }: { activeId: string | null; onOpen: (id: string) => void; onNew: () => void }) {
  const [chats, setChats] = useState<ChatEntry[]>([]);
  const [saving, setSaving] = useState(true);
  const [folded, setFolded] = useState(readFolded);

  useEffect(() => {
    const refresh = () => {
      void loadSettings().then((s) => {
        setSaving(s.saveConversations);
        if (s.saveConversations) void listChats().then(setChats); else setChats([]);
      });
    };
    refresh();
    // The list and the settings live in storage; any document changing them updates this one.
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && (changes["enki:chats"] || changes["enki:settings"])) refresh();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const fold = (next: boolean) => { setFolded(next); writeFolded(next); };

  const remove = async (id: string) => {
    if (!confirm(t.confirm)) return;
    await deleteChat(id);
    setChats(await listChats());
    if (id === activeId) onNew();
  };

  if (folded) {
    return (
      <nav aria-label={t.title} className="flex shrink-0 flex-col items-center gap-1 border-r border-fg/[0.07] px-2 py-4">
        <button type="button" onClick={() => fold(false)} title={t.unfold} aria-label={t.unfold} aria-expanded={false}
          className="rounded-lg p-2 text-muted transition hover:bg-fg/[0.07] hover:text-mist">
          <PanelLeftOpen size={18} aria-hidden />
        </button>
        <button type="button" onClick={onNew} title={t.new} aria-label={t.new}
          className="rounded-lg p-2 text-muted transition hover:bg-fg/[0.07] hover:text-mist">
          <Plus size={18} aria-hidden />
        </button>
      </nav>
    );
  }

  const groups = [0, 1, 2, 3].map((g) => chats.filter((c) => groupOf(c.updatedAt) === g));

  return (
    <nav aria-label={t.title} className="flex w-64 shrink-0 flex-col border-r border-fg/[0.07] bg-fg/[0.015]">
      <div className="flex items-center gap-1 px-3 pb-2 pt-4">
        <button type="button" onClick={onNew}
          className="flex flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-mist/90 transition hover:bg-fg/[0.07] hover:text-mist">
          <Plus size={16} aria-hidden />
          {t.new}
        </button>
        <button type="button" onClick={() => fold(true)} title={t.fold} aria-label={t.fold} aria-expanded
          className="rounded-lg p-2 text-muted transition hover:bg-fg/[0.07] hover:text-mist">
          <PanelLeftClose size={18} aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {!saving ? (
          <div className="px-2.5 py-3 text-xs text-muted">
            <p className="font-medium text-mist/80">{t.off}</p>
            <p className="mt-1 leading-relaxed">{t.offHint}</p>
          </div>
        ) : chats.length === 0 ? (
          <p className="px-2.5 py-3 text-xs text-muted">{t.empty}</p>
        ) : (
          groups.map((items, g) => items.length > 0 && (
            <section key={g} className="mt-3 first:mt-1">
              <h2 className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted/80">{t.groups[g]}</h2>
              <ul>
                {items.map((c) => (
                  <li key={c.id} className="group relative">
                    <button type="button" onClick={() => onOpen(c.id)} aria-current={c.id === activeId ? "page" : undefined} title={c.title}
                      className={`flex w-full items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-8 text-left text-sm transition ${c.id === activeId ? "bg-fg/[0.09] text-mist" : "text-mist/80 hover:bg-fg/[0.06] hover:text-mist"}`}>
                      <MessageSquare size={14} className="shrink-0 text-muted" aria-hidden />
                      <span className="truncate">{c.title || "…"}</span>
                    </button>
                    <button type="button" onClick={() => void remove(c.id)} title={t.remove} aria-label={`${t.remove}: ${c.title}`}
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted opacity-0 transition hover:bg-fg/10 hover:text-mist focus-visible:opacity-100 group-hover:opacity-100">
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </nav>
  );
}
