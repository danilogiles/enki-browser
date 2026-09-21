import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bug, Eye, MousePointerClick, Plus, Settings as SettingsIcon } from "lucide-react";
import logo from "../assets/logo.svg";
import type { ImagePart, Message, TextPart, ToolCallPart } from "../lib/types";
import { loadSettings, onSettingsChange, presetOf, saveSettings, type Settings } from "../lib/settings";
import { createProvider } from "../lib/providers";
import { BrowserExecutor, isRestrictedUrl } from "../lib/tools/executor";
import { toolsForMode } from "../lib/tools/definitions";
import { runTurn, type AgentEvent } from "../lib/agent/loop";
import { buildSystemPrompt, type Mode } from "../lib/agent/prompt";
import { Chat } from "./Chat";
import { Composer } from "./Composer";
import { SettingsView } from "./SettingsView";
import { LogsView } from "./LogsView";
import { setDevMode } from "../lib/debug";
import { uid, type Segment, type TabInfo, type UiMessage } from "./types";
import { CONVERSATION_KEY, restoreConversation, saveConversation, snapshotConversation } from "../lib/conversation";
import { invalidateObservations } from "../lib/agent/context";
import { diagnosticReport } from "../lib/diagnostics";
import { QuickModels } from "./QuickModels";

const MODE_KEY = "enki:mode";

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [view, setView] = useState<"chat" | "settings" | "logs">("chat");
  const [mode, setMode] = useState<Mode>("ask");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [approval, setApproval] = useState<{ label: string; resolve: (ok: boolean) => void } | null>(null);
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [usage, setUsage] = useState({ input: 0, output: 0 });
  const [ready, setReady] = useState(false);
  const [banner, setBanner] = useState("");
  const [progress, setProgress] = useState({ message: "Ready", step: 0, model: "", since: Date.now() });
  const [elapsed, setElapsed] = useState(0);
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [selectedTab, setSelectedTab] = useState<number | null>(null);
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
        const stored = await chrome.storage.local.get(CONVERSATION_KEY);
        const restored = restoreConversation(stored[CONVERSATION_KEY]);
        if (restored) {
          historyRef.current = restored.history;
          restoredRef.current = true;
          setMessages(restored.messages);
          setBanner("Conversation restored locally. Page observations will be refreshed before continuing.");
        }
      }
      setReady(true);
      const preset = presetOf(s.preset);
      if (!s.apiKey && !preset.keyOptional) setView("settings");
    });
    chrome.storage.local.get(MODE_KEY).then((v) => {
      if (v[MODE_KEY] === "act" || v[MODE_KEY] === "ask") setMode(v[MODE_KEY]);
    });
    return onSettingsChange(setSettings);
  }, []);

  useEffect(() => {
    if (settings?.theme) {
      document.documentElement.setAttribute("data-theme", settings.theme);
    }
  }, [settings?.theme]);

  useEffect(() => setDevMode(!!settings?.devMode), [settings?.devMode]);

  useEffect(() => {
    if (!ready || !settings) return;
    if (!settings.saveConversations) { void saveConversation(null); return; }
    const persist = () => { void saveConversation(snapshotConversation(historyRef.current, messages)).catch(() => setBanner("Could not save this conversation. Browser storage may be full.")); };
    // Avoid serializing storage writes for every streamed token. Tool boundaries save immediately.
    const last = messages[messages.length - 1];
    const segments = last?.segments ?? [];
    const toolBoundary = segments[segments.length - 1]?.kind === "tool";
    const timer = setTimeout(persist, running && !toolBoundary ? 250 : 0);
    window.addEventListener("pagehide", persist);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", persist); };
  }, [messages, ready, running, settings?.saveConversations]);

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
      setTabs(list.filter((t) => t.id && !isRestrictedUrl(t.url)).map((t) => ({ id: t.id!, title: t.title ?? "", url: t.url ?? "" })));
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
      const context = current ? `[Current tab] ${current.title ?? ""} — ${current.url ?? ""}${restricted ? " (browser-internal page)" : ""}` : "[No active tab]";
      const parts: Array<TextPart | ImagePart> = [{ type: "text", text: `${context}\n\n${text.trim()}` }];
      let thumb: string | undefined;
      if (settings.vision && settings.attachScreenshot && !restricted) {
        try {
          const shot = await executor.screenshot();
          parts.push({ type: "image", mediaType: shot.mediaType, data: shot.data });
          thumb = `data:${shot.mediaType};base64,${shot.data}`;
        } catch { /* a background controlled tab must never capture the active tab */ }
      }
      if (controller.signal.aborted) return;
      history.push({ role: "user", parts });
      setMessages((prev) => [...prev,
        { id: uid(), role: "user", text: text.trim(), screenshot: thumb },
        { id: assistantId, role: "assistant", segments: [], streaming: true }]);
      visible = true;
      if (mode === "act") await executor.setActiveOverlay(true, "Enki is controlling this tab…");
      const effectiveMode = intent === "observe" ? "ask" : mode;
      await runTurn({ provider: createProvider(settings), model: settings.model, mode: effectiveMode,
        system: buildSystemPrompt(effectiveMode, settings.customInstructions), history,
        tools: toolsForMode(effectiveMode, settings.vision), executor, maxSteps: settings.maxSteps,
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
  }, [settings, ready, selectedTab, mode, requestApproval, handleEvent]);

  const stop = () => abortRef.current?.abort();
  const retry = useCallback(() => {
    if (abortRef.current) return;
    invalidateObservations(historyRef.current);
    void send("Continue the previous task. Check which actions already succeeded and do not repeat them. Ask me if an interrupted action's outcome is uncertain.", "continue");
  }, [send]);

  const newChat = () => {
    stop();
    historyRef.current = [];
    restoredRef.current = false;
    setMessages([]);
    setUsage({ input: 0, output: 0 });
    setApproval(null);
    setBanner("");
    setSelectedTab(null);
    void saveConversation(null);
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
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
        <img src={logo} alt="" className="h-6 w-6 rounded-md" />
        <span className="font-semibold tracking-tight">Enki</span>
        <button
          type="button"
          onClick={() => setView("settings")}
          title={`Active model: ${settings.model} (${presetOf(settings.preset).label}). Click to open settings.`}
          className="max-w-[120px] truncate rounded bg-ink-800/80 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-ink-700 hover:text-zinc-200"
        >
          {settings.model || settings.preset}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <ModeToggle mode={mode} onChange={changeMode} disabled={running} />
          {settings.devMode && (
            <IconButton title="Logs" onClick={() => setView("logs")}>
              <Bug size={16} />
            </IconButton>
          )}
          <IconButton title="New chat" onClick={newChat}>
            <Plus size={16} />
          </IconButton>
          <IconButton title="Settings" onClick={() => setView("settings")}>
            <SettingsIcon size={16} />
          </IconButton>
        </div>
      </header>

      <QuickModels settings={settings} disabled={running} onChange={(model) => { void saveSettings({ ...settings, model }); }} />
      <div className="border-b border-ink-800 px-3 py-2 text-xs">
        <label htmlFor="controlled-tab" className="mb-1 block text-zinc-400">Controlled tab {running ? "(locked for this task)" : ""}</label>
        <select id="controlled-tab" disabled={running} value={selectedTab ?? ""} onChange={(e) => setSelectedTab(e.target.value ? Number(e.target.value) : null)} className="w-full min-w-0 rounded border border-ink-700 bg-ink-900 p-1.5 text-zinc-200">
          <option value="">Use active tab when task starts</option>
          {selectedTab !== null && !tabs.some((t) => t.id === selectedTab) && <option value={selectedTab}>Selected tab unavailable</option>}
          {tabs.map((t) => <option value={t.id} key={t.id}>{t.title || t.url}</option>)}
        </select>
      </div>
      {banner && <div role="status" className="border-b border-ink-800 px-3 py-2 text-xs text-amber-200">{banner} <button className="underline" onClick={() => setBanner("")}>Dismiss</button></div>}
      {running && <div role="status" className="border-b border-ink-800 px-3 py-2 text-xs text-enki-400">
        {progress.message === "Waiting for provider" ? `Waiting for ${presetOf(settings.preset).label.split(" (")[0]}` : progress.message} · {elapsed}s
        <div className="truncate text-zinc-400">{progress.step > 0 ? `Step ${progress.step}/${settings.maxSteps} · ` : ""}{progress.model}</div>
      </div>}

      {tab && (
        <div className="flex items-center gap-2 border-b border-ink-800 bg-ink-900/60 px-3 py-1.5 text-xs text-zinc-400">
          {tab.favIconUrl ? (
            <img src={tab.favIconUrl} alt="" className="h-3.5 w-3.5 rounded-sm" />
          ) : (
            <span className="h-3.5 w-3.5 rounded-sm bg-ink-700" />
          )}
          <span className="truncate" title={tab.url}>
            {tab.title || tab.url}
          </span>
          {isRestrictedUrl(tab.url) && <span className="ml-auto shrink-0 text-amber-400">internal page</span>}
        </div>
      )}

      <Chat
        messages={messages}
        approval={approval}
        mode={mode}
        onSuggest={send}
        onRetry={running ? undefined : retry}
        model={settings.model}
      />

      {!running && messages.length > 0 && <div className="flex flex-wrap gap-2 border-t border-ink-800 px-3 py-2 text-xs">
        <button className="rounded border border-ink-700 px-2 py-1 text-enki-400" onClick={retry}>Continue safely</button>
        <button className="rounded border border-ink-700 px-2 py-1" onClick={() => { invalidateObservations(historyRef.current); void send("Read the current page again and report its state.", "observe"); }}>Read page again</button>
        <button className="rounded border border-ink-700 px-2 py-1" onClick={() => setView("settings")}>Switch model</button>
        <button className="rounded border border-ink-700 px-2 py-1" onClick={() => navigator.clipboard.writeText(diagnosticReport(settings)).then(() => setBanner("Diagnostic report copied. Page content and credentials excluded."), () => setBanner("Clipboard unavailable. Open Logs to export the report."))}>Copy diagnostics</button>
      </div>}

      {needsKey && (
        <div className="mx-3 mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Add an API key in{" "}
          <button className="underline" onClick={() => setView("settings")}>
            Settings
          </button>{" "}
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
        usage={usage}
      />
    </div>
  );
}

function ModeToggle({ mode, onChange, disabled }: { mode: Mode; onChange: (m: Mode) => void; disabled: boolean }) {
  const btn = (m: Mode, icon: ReactNode, label: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(m)}
      title={m === "ask" ? "Ask: Enki can only look at the page" : "Act: Enki can navigate, click and type"}
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-60 ${
        mode === m ? "bg-enki-500/20 text-enki-400" : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="flex rounded-lg border border-ink-700 bg-ink-900 p-0.5">
      {btn("ask", <Eye size={13} />, "Ask")}
      {btn("act", <MousePointerClick size={13} />, "Act")}
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-md p-1.5 text-zinc-400 transition hover:bg-ink-800 hover:text-zinc-100"
    >
      {children}
    </button>
  );
}
