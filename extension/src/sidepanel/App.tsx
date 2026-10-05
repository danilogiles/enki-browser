import { useCallback, useEffect, useRef, useState } from "react";
import type { ImagePart, Message, TextPart, ToolCallPart } from "../lib/types";
import { loadSettings, onSettingsChange, presetOf, saveSettings, type Settings } from "../lib/settings";
import { onHandoff, takeHandoff, type Handoff } from "../lib/handoff";
import { createProvider } from "../lib/providers";
import { BrowserExecutor, isRestrictedUrl } from "../lib/tools/executor";
import { toolsForMode } from "../lib/tools/definitions";
import { runTurn, type AgentEvent } from "../lib/agent/loop";
import { buildSystemPrompt, type Mode } from "../lib/agent/prompt";
import { Chat, type Progress } from "./Chat";
import { Composer } from "./Composer";
import { SettingsView } from "./SettingsView";
import { LogsView } from "./LogsView";
import { log, setDevMode } from "../lib/debug";
import { uid, type Segment, type TabInfo, type UiMessage } from "./types";
import { snapshotConversation } from "../lib/conversation";
import { clearChats, currentChat, deleteChat, listChats, loadChat, saveChat, setCurrentChat, type ChatEntry } from "../lib/history";
import { applyTheme } from "../lib/theme";
import { Header } from "./Header";
import { invalidateObservations } from "../lib/agent/context";
import { diagnosticReport } from "../lib/diagnostics";
import { connectorTools, loadConnections, onConnectionsChange, type Connection } from "../lib/connectors";
import { expand, loadTasks, suggestions, type SavedTask } from "../lib/shortcuts";

const MODE_KEY = "enki:mode";

/**
 * The date and time travel with every message: the model's own sense of "now" is its training
 * cutoff, and without this it denied events happening that day (an election and its live results).
 */
/**
 * Opened as a tab with ?q= — Enki as the address bar's search engine — the panel is an answer
 * page: it asks the question at once in Ask mode, starts a fresh chat instead of reopening the
 * panel's, and leaves the panel's current chat and mode alone.
 */
const PAGE_QUERY = new URLSearchParams(location.search).get("q")?.trim() || null;

function nowLine(): string {
  const now = new Date();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const local = now.toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `[Now] ${local} (${zone}; ${now.toISOString().slice(0, 10)})`;
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [view, setView] = useState<"chat" | "settings" | "logs">("chat");
  const [mode, setMode] = useState<Mode>("ask");
  // Connected apps (Settings → Connections) and saved tasks, kept current while the panel is open.
  const [apps, setApps] = useState<Connection[]>([]);
  const [tasks, setTasks] = useState<SavedTask[]>([]);
  useEffect(() => {
    void loadConnections().then(setApps);
    void loadTasks().then(setTasks);
    const onTasks = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes["enki:tasks"]) setTasks((changes["enki:tasks"].newValue as SavedTask[] | undefined) ?? []);
    };
    chrome.storage.onChanged.addListener(onTasks);
    const off = onConnectionsChange(setApps);
    return () => { off(); chrome.storage.onChanged.removeListener(onTasks); };
  }, []);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [approval, setApproval] = useState<{ label: string; resolve: (ok: boolean) => void } | null>(null);
  // The active tab is tracked for the tab picker in the "more" menu; nothing else shows it now.
  const [, setTab] = useState<TabInfo | null>(null);
  const [usage, setUsage] = useState({ input: 0, output: 0 });
  const [ready, setReady] = useState(false);
  const [banner, setBanner] = useState("");
  const [progress, setProgress] = useState({ message: "Ready", step: 0, model: "", since: Date.now() });
  const [elapsed, setElapsed] = useState(0);
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [selectedTab, setSelectedTab] = useState<number | null>(null);
  // The saved chat this conversation belongs to; a new chat gets an id on its first message.
  const [chatId, setChatId] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatEntry[]>([]);
  const windowRef = useRef<number | undefined>(undefined);
  const restoredRef = useRef(false);

  const historyRef = useRef<Message[]>([]);
  const executorRef = useRef<BrowserExecutor | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ----- settings -----
  useEffect(() => {
    loadSettings().then(async (s) => {
      setSettings(s);
      if (s.saveConversations) {
        setChats(await listChats());
      }
      if (s.saveConversations && !PAGE_QUERY) {
        // Reopen the chat that was open, not merely the newest: after New chat there is none.
        const open = await currentChat();
        const restored = open ? await loadChat(open) : null;
        if (open && restored) {
          historyRef.current = restored.history;
          restoredRef.current = true;
          setMessages(restored.messages);
          setChatId(open);
        }
      }
      setReady(true);
      const preset = presetOf(s.preset);
      if (!s.apiKey && !preset.keyOptional) setView("settings");
    });
    if (!PAGE_QUERY) chrome.storage.local.get(MODE_KEY).then((v) => {
      if (v[MODE_KEY] === "act" || v[MODE_KEY] === "ask") setMode(v[MODE_KEY]);
    });
    if (PAGE_QUERY) document.title = `${PAGE_QUERY} — Enki`;
    return onSettingsChange(setSettings);
  }, []);

  useEffect(() => {
    if (settings) applyTheme(document.documentElement, settings.theme, settings.customTheme);
  }, [settings?.theme, settings?.customTheme]);

  useEffect(() => setDevMode(!!settings?.devMode), [settings?.devMode]);

  useEffect(() => {
    if (!ready || !settings) return;
    if (!settings.saveConversations) { void clearChats().then(() => setChats([])); return; }
    if (!messages.length) return;
    const id = chatId ?? uid();
    if (!chatId) { setChatId(id); if (!PAGE_QUERY) void setCurrentChat(id); }
    const persist = () => {
      void saveChat(id, snapshotConversation(historyRef.current, messages))
        .then(() => listChats().then(setChats))
        .catch(() => setBanner("Could not save this conversation. Browser storage may be full."));
    };
    // Avoid serializing storage writes for every streamed token. Tool boundaries save immediately.
    const last = messages[messages.length - 1];
    const segments = last?.segments ?? [];
    const toolBoundary = segments[segments.length - 1]?.kind === "tool";
    const timer = setTimeout(persist, running && !toolBoundary ? 250 : 0);
    window.addEventListener("pagehide", persist);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", persist); };
  }, [messages, ready, running, settings?.saveConversations, chatId]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - progress.since) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running, progress.since]);

  const changeMode = (m: Mode) => {
    setMode(m);
    chrome.storage.local.set({ [MODE_KEY]: m });
    if (settings) {
      const model = m === "ask" ? settings.askModel : settings.actModel;
      if (model) void saveSettings({ ...settings, model });
    }
  };

  // ----- current tab tracking -----
  useEffect(() => {
    let windowId: number | undefined;
    const refresh = async () => {
      if (windowId === undefined) return;
      const [t] = await chrome.tabs.query({ active: true, windowId });
      const list = await chrome.tabs.query({ windowId });
      // Internal pages stay in the list: Enki cannot read them, but in Act mode it can navigate
      // away from them. Hiding them made a pinned new tab show up as "unavailable".
      setTabs(list.filter((t) => t.id).map((t) => ({ id: t.id!, title: t.title ?? "", url: t.url ?? "" })));
      if (t?.id) setTab({ id: t.id, title: t.title ?? "", url: t.url ?? "", favIconUrl: t.favIconUrl });
    };
    // Normally the panel controls the window it is docked in. When the panel is opened as a
    // regular tab (debugging, automated tests), `?window=<id>` selects the window to control.
    const override = Number(new URLSearchParams(location.search).get("window"));
    const resolveWindow = override ? Promise.resolve({ id: override }) : chrome.windows.getCurrent();
    resolveWindow.then((w) => {
      windowId = w.id;
      windowRef.current = w.id;
      if (w.id !== undefined) executorRef.current = new BrowserExecutor(w.id);
      refresh();
    });
    const onActivated = (info: chrome.tabs.OnActivatedInfo) => {
      if (info.windowId === windowId) refresh();
    };
    const onUpdated = (_id: number, change: chrome.tabs.OnUpdatedInfo, t: chrome.tabs.Tab) => {
      if (t.active && t.windowId === windowId && (change.title || change.url || change.status === "complete")) refresh();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  // ----- message helpers -----
  const patchLast = useCallback((fn: (m: UiMessage) => UiMessage) => {
    setMessages((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== "assistant") return prev;
      return [...prev.slice(0, -1), fn(last)];
    });
  }, []);

  const patchSegments = useCallback(
    (fn: (segs: Segment[]) => Segment[]) => patchLast((m) => ({ ...m, segments: fn(m.segments ?? []) })),
    [patchLast],
  );

  const handleEvent = useCallback(
    (e: AgentEvent) => {
      switch (e.type) {
        case "status":
          setProgress((p) => p.message === e.message && p.step === e.step ? { ...p, model: e.model ?? p.model }
            : { message: e.message, step: e.step, model: e.model ?? p.model, since: Date.now() });
          setElapsed(0);
          break;
        case "summary":
          patchLast((m) => ({ ...m, summary: e }));
          break;
        case "assistant_start":
          patchSegments((segs) => {
            const last = segs[segs.length - 1];
            return last?.kind === "text" && !last.text ? segs : [...segs, { kind: "text", text: "" }];
          });
          break;
        case "text":
          patchSegments((segs) => {
            const last = segs[segs.length - 1];
            if (last?.kind === "text") return [...segs.slice(0, -1), { kind: "text", text: last.text + e.delta }];
            return [...segs, { kind: "text", text: e.delta }];
          });
          break;
        case "thinking":
          patchLast((m) => ({ ...m, thinking: (m.thinking ?? "") + e.delta }));
          break;
        case "notice":
          patchLast((m) => ({ ...m, note: m.note ? `${m.note} ${e.message}` : e.message }));
          break;
        case "retract_text":
          patchSegments((segs) => {
            const i = segs.map((s) => s.kind).lastIndexOf("text");
            return i === -1 ? segs : [...segs.slice(0, i), ...segs.slice(i + 1)];
          });
          break;
        case "promote_thinking":
          patchLast((m) => {
            const t = (m.thinking ?? "").trim();
            if (!t) return m;
            return {
              ...m,
              thinking: undefined,
              segments: [...(m.segments ?? []).filter((s) => !(s.kind === "text" && !s.text)), { kind: "text", text: t }],
            };
          });
          break;
        case "tool_start":
          patchSegments((segs) => [
            ...segs.filter((s) => !(s.kind === "text" && !s.text)),
            { kind: "tool", id: e.call.id, name: e.call.name, label: e.label, status: "running", sensitive: e.sensitive },
          ]);
          break;
        case "approval_request":
          patchSegments((segs) =>
            segs.map((s) => (s.kind === "tool" && s.id === e.call.id ? { ...s, status: "awaiting" } : s)),
          );
          break;
        case "tool_result": {
          const output = e.result.content
            .map((c) => (c.type === "text" ? c.text : "[image]"))
            .join("\n")
            .slice(0, 2000);
          patchSegments((segs) =>
            segs.map((s) =>
              s.kind === "tool" && s.id === e.call.id
                ? { ...s, status: e.declined ? "declined" : e.result.isError ? "error" : "done", output }
                : s,
            ),
          );
          break;
        }
        case "usage":
          setUsage((u) => ({ input: u.input + e.inputTokens, output: u.output + e.outputTokens }));
          break;
        case "done":
          patchLast((m) => ({
            ...m,
            streaming: false,
            // Keep any notice already attached to this turn (parenthesised: `??` binds tighter
            // than `?:`, so without these the note itself became the condition).
            note:
              m.note ??
              (e.reason === "max_steps"
                ? "Stopped: reached the step limit. Send another message to continue."
                : e.reason === "aborted"
                  ? "Stopped."
                  : e.reason === "refusal"
                    ? "The model declined to continue with this request."
                    : e.reason === "empty"
                      ? "The model returned an empty reply twice. Try again, rephrase, or pick another model in Settings."
                      : e.reason === "max_tokens"
                        ? "The reply was cut off at the token limit."
                        : undefined),
          }));
          break;
        case "error":
          patchLast((m) => ({ ...m, streaming: false, error: e.message }));
          break;
      }
    },
    [patchLast, patchSegments],
  );

  const requestApproval = useCallback(
    (label: string, _call: ToolCallPart) =>
      new Promise<boolean>((resolve) => {
        const signal = abortRef.current?.signal;
        const finish = (ok: boolean) => {
          signal?.removeEventListener("abort", cancel);
          setApproval(null);
          resolve(ok);
        };
        const cancel = () => finish(false);
        if (signal?.aborted) return cancel();
        signal?.addEventListener("abort", cancel, { once: true });
        setApproval({
          label,
          resolve: finish,
        });
      }),
    [],
  );

  // ----- send -----
  const send = useCallback(async (text: string, intent: "normal" | "continue" | "observe" = "normal") => {
    const executor = executorRef.current;
    if (!settings || !executor || !ready || abortRef.current || !text.trim()) return;
    // /task runs a saved task in its own mode; @app points the request at one connected app.
    // The answer page only answers, so a task saved for Act runs there as Ask.
    const ex = intent === "normal" ? expand(text, tasks, apps) : ({ text: text.trim() } as ReturnType<typeof expand>);
    text = ex.text;
    const runMode: Mode = PAGE_QUERY ? "ask" : ex.mode ?? mode;
    executor.setConnections(apps);
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress({ message: "Preparing page", step: 0, model: settings.model, since: Date.now() });
    setElapsed(0);
    const history = historyRef.current;
    // A fixed id keeps late events from a cancelled task out of a new conversation.
    const assistantId = uid();
    let visible = false;
    try {
      executor.lockTab(selectedTab);
      const current = await executor.currentTab().catch(() => null);
      if (selectedTab !== null && !current) throw new Error("The selected tab was closed. Choose another tab.");
      if (current?.id) { executor.lockTab(current.id); setSelectedTab(current.id); }
      if (controller.signal.aborted) return;
      const restricted = !current || isRestrictedUrl(current.url);
      const context = PAGE_QUERY
        ? "[Current tab] none: this is Enki's answer page, opened from the address bar. There is no page to read; answer from your knowledge or, for anything current, from web_search and read_url."
        : current ? `[Current tab] ${current.title ?? ""} — ${current.url ?? ""}${restricted ? " (browser-internal page)" : ""}` : "[No active tab]";
      const hint = ex.hint ? `\n${ex.hint}` : "";
      const parts: Array<TextPart | ImagePart> = [{ type: "text", text: `${nowLine()}\n${context}${hint}\n\n${text.trim()}` }];
      let thumb: string | undefined;
      if (settings.vision && settings.attachScreenshot && !restricted) {
        // captureVisibleTab fails transiently while a page is still painting and is limited to two
        // calls a second, so one retry recovers most failures. A background controlled tab is
        // refused on purpose (never capture a different tab) and is not retried.
        for (let attempt = 0; attempt < 2 && !thumb; attempt++) {
          try {
            const shot = await executor.screenshot();
            parts.push({ type: "image", mediaType: shot.mediaType, data: shot.data });
            thumb = `data:${shot.mediaType};base64,${shot.data}`;
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            if (/Select the controlled tab/.test(message)) break;
            if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
            else log.warn("agent", "Screenshot not attached; the model sees the page text only", { error: message });
          }
        }
      }
      if (controller.signal.aborted) return;
      history.push({ role: "user", parts });
      setMessages((prev) => [...prev,
        { id: uid(), role: "user", text: text.trim(), screenshot: thumb },
        { id: assistantId, role: "assistant", segments: [], streaming: true }]);
      visible = true;
      if (runMode === "act") await executor.setActiveOverlay(true, "Enki is controlling this tab…");
      const effectiveMode = intent === "observe" ? "ask" : runMode;
      await runTurn({ provider: createProvider(settings), model: settings.model, mode: effectiveMode,
        system: buildSystemPrompt(effectiveMode, settings.customInstructions, settings.devMode && !!settings.unfiltered), history,
        tools: [...toolsForMode(effectiveMode, settings.vision), ...connectorTools(apps)], executor, maxSteps: settings.maxSteps,
        autoApprove: settings.autoApprove, requestApproval,
        onEvent: (e) => { if (historyRef.current === history) handleEvent(e); },
        signal: controller.signal, contextBudgetTokens: settings.contextBudgetTokens,
        maxOutputTokens: settings.maxOutputTokens, refreshPage: intent !== "normal" || restoredRef.current,
      });
      restoredRef.current = false;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (visible && historyRef.current === history) handleEvent({ type: "error", message });
      else setBanner(message);
    } finally {
      await executor.setActiveOverlay(false).catch(() => undefined);
      // Keep a tab pinned across tasks only when the agent itself switched or opened one.
      // Pinning whatever tab happened to be active would silently detach later questions from
      // the tab the user is actually looking at.
      const retargeted = executor.agentSelectedTab();
      if (retargeted !== null && historyRef.current === history) setSelectedTab(retargeted);
      executor.lockTab(null);
      setRunning(false);
      abortRef.current = null;
    }
  }, [settings, ready, selectedTab, mode, requestApproval, handleEvent, tasks, apps]);

  const stop = () => abortRef.current?.abort();
  const retry = useCallback(() => {
    if (abortRef.current) return;
    invalidateObservations(historyRef.current);
    void send("Continue the previous task. Check which actions already succeeded and do not repeat them. Ask me if an interrupted action's outcome is uncertain.", "continue");
  }, [send]);

  // A request typed on Enki Home arrives here. It waits for the panel to be ready and idle, in
  // the mode the user picked there, and for a usable provider — without one it opens Settings
  // and is sent as soon as they are saved.
  const [handoff, setHandoff] = useState<Handoff | null>(PAGE_QUERY ? { text: PAGE_QUERY, mode: "ask", at: Date.now() } : null);
  useEffect(() => {
    // A request typed on Enki Home is for the side panel, not for an answer page.
    if (PAGE_QUERY) return;
    const grab = () => void takeHandoff().then((h) => h && setHandoff(h));
    grab();
    return onHandoff(grab);
  }, []);
  useEffect(() => {
    if (!handoff || !ready || !settings || running) return;
    if (!settings.apiKey && !presetOf(settings.preset).keyOptional) { setView("settings"); return; }
    if (handoff.mode !== mode) { changeMode(handoff.mode); return; }
    setHandoff(null);
    setView("chat");
    void send(handoff.text);
    // changeMode is recreated each render; the effect re-runs on the state it changes instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff, ready, settings, running, mode, send]);

  const newChat = () => {
    stop();
    historyRef.current = [];
    restoredRef.current = false;
    setMessages([]);
    setUsage({ input: 0, output: 0 });
    setApproval(null);
    setBanner("");
    setSelectedTab(null);
    setChatId(null);
    void setCurrentChat(null);
  };

  const openChat = async (id: string) => {
    if (abortRef.current) return;
    const restored = await loadChat(id);
    if (!restored) { setBanner("That chat could not be opened."); return; }
    historyRef.current = restored.history;
    restoredRef.current = true;
    setMessages(restored.messages);
    setUsage({ input: 0, output: 0 });
    setApproval(null);
    setBanner("");
    setChatId(id);
    void setCurrentChat(id);
    setView("chat");
  };

  const removeChat = async (id: string) => {
    await deleteChat(id);
    setChats(await listChats());
    if (id === chatId) newChat();
  };

  // Empty deps on purpose: stop/newChat only touch refs and stable setters, and re-subscribing
  // both listeners on every render would churn them dozens of times a second while streaming.
  useEffect(() => {
    const command = (msg: { type?: string; command?: string; windowId?: number }) => {
      if (msg.type !== "enki:command" || msg.windowId !== windowRef.current) return;
      if (msg.command === "stop-task") stop();
      if (msg.command === "new-chat") newChat();
      if (msg.command === "focus-composer") { setView("chat"); setTimeout(() => document.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 0); }
    };
    chrome.runtime.onMessage.addListener(command);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Escape closes a dropdown or reverts a field first. Killing a running task because the
      // user dismissed the tab selector would be its own bug.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "SELECT" || tag === "INPUT") return;
      stop();
    };
    document.addEventListener("keydown", key);
    return () => { chrome.runtime.onMessage.removeListener(command); document.removeEventListener("keydown", key); };
  }, []);

  const toggleScreenshot = async () => {
    if (!settings || !settings.vision) return;
    const next = { ...settings, attachScreenshot: !settings.attachScreenshot };
    setSettings(next);
    await saveSettings(next);
  };

  if (!settings || !ready) return null;

  if (view === "logs") return <LogsView settings={settings} onClose={() => setView("chat")} />;

  if (view === "settings") {
    return (
      <SettingsView
        settings={settings}
        onSave={async (s) => {
          await saveSettings(s);
          setSettings(s);
          setView("chat");
        }}
        onClose={() => setView("chat")}
      />
    );
  }

  const needsKey = !settings.apiKey && !presetOf(settings.preset).keyOptional;

  return (
    <div className={`flex h-full flex-col ${PAGE_QUERY ? "page-mode mx-auto w-full max-w-3xl" : ""}`}>
      <Header
        settings={settings}
        running={running}
        onModel={(model) => { void saveSettings({ ...settings, model }); }}
        onOpenSettings={() => setView("settings")}
        chats={settings.saveConversations ? chats : []}
        currentChat={chatId}
        onNewChat={newChat}
        onOpenChat={(id) => { void openChat(id); }}
        onDeleteChat={(id) => { void removeChat(id); }}
        canContinue={!running && messages.length > 0}
        onContinue={retry}
        onReadAgain={() => { invalidateObservations(historyRef.current); void send("Read the current page again and report its state.", "observe"); }}
        onCopyDiagnostics={() => navigator.clipboard.writeText(diagnosticReport(settings)).then(() => setBanner("Diagnostic report copied. Page content and credentials excluded."), () => setBanner("Clipboard unavailable. Open Logs to export the report."))}
        onLogs={settings.devMode ? () => setView("logs") : undefined}
        tabs={tabs}
        selectedTab={selectedTab}
        onSelectTab={setSelectedTab}
        usage={usage}
      />
      {banner && <div role="status" className="mx-3 mb-1 rounded-lg bg-ink-900 px-3 py-1.5 text-xs text-zinc-400">{banner} <button className="underline" onClick={() => setBanner("")}>Dismiss</button></div>}

      <Chat
        messages={messages}
        approval={approval}
        mode={mode}
        onSuggest={send}
        onRetry={running ? undefined : retry}
        showSteps={settings.showSteps !== false}
        showRunDetails={settings.showRunDetails !== false}
        progress={running ? { ...progress, maxSteps: settings.maxSteps, elapsed, message: progress.message === "Waiting for provider" ? `Waiting for ${presetOf(settings.preset).label.split(" (")[0]}` : progress.message } as Progress : null}
      />

      {needsKey && (
        <div className="mx-3 mb-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Add an API key in{" "}
          <button className="underline" onClick={() => setView("settings")}>Settings</button>{" "}
          to start.
        </div>
      )}

      <Composer
        disabled={needsKey}
        running={running}
        onSend={send}
        onStop={stop}
        attachScreenshot={settings.vision && settings.attachScreenshot}
        vision={settings.vision}
        onToggleScreenshot={toggleScreenshot}
        mode={mode}
        onMode={PAGE_QUERY ? undefined : changeMode}
        suggest={(v) => suggestions(v, tasks, apps)}
        onSettings={() => setView("settings")}
      />
    </div>
  );
}
