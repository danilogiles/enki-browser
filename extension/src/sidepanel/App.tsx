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

  const historyRef = useRef<Message[]>([]);
  const executorRef = useRef<BrowserExecutor | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ----- settings -----
  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
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

  const changeMode = (m: Mode) => {
    setMode(m);
    chrome.storage.local.set({ [MODE_KEY]: m });
  };

  // ----- current tab tracking -----
  useEffect(() => {
    let windowId: number | undefined;
    const refresh = async () => {
      if (windowId === undefined) return;
      const [t] = await chrome.tabs.query({ active: true, windowId });
      if (t?.id) setTab({ id: t.id, title: t.title ?? "", url: t.url ?? "", favIconUrl: t.favIconUrl });
    };
    // Normally the panel controls the window it is docked in. When the panel is opened as a
    // regular tab (debugging, automated tests), `?window=<id>` selects the window to control.
    const override = Number(new URLSearchParams(location.search).get("window"));
    const resolveWindow = override ? Promise.resolve({ id: override }) : chrome.windows.getCurrent();
    resolveWindow.then((w) => {
      windowId = w.id;
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
            note:
              e.reason === "max_steps"
                ? "Stopped: reached the step limit. Send another message to continue."
                : e.reason === "aborted"
                  ? "Stopped."
                  : e.reason === "refusal"
                    ? "The model declined to continue with this request."
                    : e.reason === "empty"
                      ? "The model returned an empty reply twice. Try again, rephrase, or pick another model in Settings."
                      : e.reason === "max_tokens"
                        ? "The reply was cut off at the token limit."
                        : undefined,
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
        setApproval({
          label,
          resolve: (ok) => {
            setApproval(null);
            resolve(ok);
          },
        });
      }),
    [],
  );

  // ----- send -----
  const send = useCallback(
    async (text: string) => {
      const executor = executorRef.current;
      if (!settings || !executor || running) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      setRunning(true);
      const controller = new AbortController();
      abortRef.current = controller;

      let current: chrome.tabs.Tab | null = null;
      try {
        current = await executor.currentTab();
      } catch {
        /* no tab */
      }
      const restricted = !current || isRestrictedUrl(current.url);
      const context = current
        ? `[Current tab] ${current.title ?? ""} — ${current.url ?? ""}${restricted ? " (browser-internal page: tools cannot read it)" : ""}`
        : "[No active tab]";

      const parts: Array<TextPart | ImagePart> = [{ type: "text", text: `${context}\n\n${trimmed}` }];
      let thumb: string | undefined;
      if (settings.vision && settings.attachScreenshot && !restricted) {
        try {
          const shot = await executor.screenshot();
          parts.push({ type: "image", mediaType: shot.mediaType, data: shot.data });
          thumb = `data:${shot.mediaType};base64,${shot.data}`;
        } catch {
          /* screenshot unavailable; continue without */
        }
      }
      historyRef.current.push({ role: "user", parts });
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "user", text: trimmed, screenshot: thumb },
        { id: uid(), role: "assistant", segments: [], streaming: true },
      ]);

      if (mode === "act") {
        await executor.setActiveOverlay(true, "Enki is controlling this tab…");
      }
      try {
        await runTurn({
          provider: createProvider(settings),
          model: settings.model,
          system: buildSystemPrompt(mode, settings.customInstructions),
          history: historyRef.current,
          tools: toolsForMode(mode, settings.vision),
          executor,
          maxSteps: settings.maxSteps,
          autoApprove: settings.autoApprove,
          requestApproval,
          onEvent: handleEvent,
          signal: controller.signal,
        });
      } finally {
        await executor.setActiveOverlay(false);
        setRunning(false);
        abortRef.current = null;
      }
    },
    [settings, running, mode, requestApproval, handleEvent],
  );

  const stop = () => abortRef.current?.abort();

  const retry = useCallback(() => {
    const lastUser = [...historyRef.current].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const textPart = lastUser.parts.find((p) => p.type === "text") as { text: string } | undefined;
    if (!textPart) return;
    const raw = textPart.text;
    const idx = raw.indexOf("\n\n");
    const userPrompt = idx !== -1 ? raw.slice(idx + 2) : raw;
    send(userPrompt);
  }, [send]);

  const newChat = () => {
    stop();
    historyRef.current = [];
    setMessages([]);
    setUsage({ input: 0, output: 0 });
    setApproval(null);
  };

  const toggleScreenshot = async () => {
    if (!settings || !settings.vision) return;
    const next = { ...settings, attachScreenshot: !settings.attachScreenshot };
    setSettings(next);
    await saveSettings(next);
  };

  if (!settings) return null;

  if (view === "logs") return <LogsView onClose={() => setView("chat")} />;

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
        onRetry={retry}
        model={settings.model}
      />

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
