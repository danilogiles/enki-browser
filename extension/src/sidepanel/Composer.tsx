import { useEffect, useRef, useState } from "react";
import { ArrowUp, Camera, CameraOff, Loader2, Mic, Monitor, Search, Settings as SettingsIcon, Square } from "lucide-react";
import { askMicrophonePermission, startRecording, transcribe, uiLanguage, type Recording, type VoiceState } from "../lib/voice";
import type { Mode } from "../lib/agent/prompt";

/**
 * The request box, in the shape of Comet's: the text on top, and one quiet row underneath with the
 * mode (Ask reads the page, Act drives it) on the left and settings and send on the right.
 */
type Props = {
  disabled: boolean;
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  attachScreenshot: boolean;
  vision: boolean;
  onToggleScreenshot: () => void;
  mode: Mode;
  /** Omitted on the answer page, which only answers: acting there would navigate the answer away. */
  onMode?: (m: Mode) => void;
  onSettings: () => void;
  /** Saved tasks (/name) and connected apps (@app) matching what is being typed. */
  suggest?: (value: string) => Array<{ insert: string; label: string; detail: string }>;
};

export function Composer({ disabled, running, onSend, onStop, attachScreenshot, vision, onToggleScreenshot, mode, onMode, onSettings, suggest }: Props) {
  const [value, setValue] = useState("");
  const [pick, setPick] = useState(0);
  const options = suggest?.(value) ?? [];
  const choose = (i: number) => { setValue(options[i].insert); setPick(0); ref.current?.focus(); };
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(Math.max(el.scrollHeight, 44), 180) + "px";
  }, [value]);

  // Voice: click to talk, click again to stop; the text lands in the box to check before sending.
  const [voice, setVoice] = useState<VoiceState>({ kind: "idle" });
  const recording = useRef<Recording | null>(null);
  useEffect(() => () => recording.current?.cancel(), []);
  const toggleVoice = async () => {
    if (voice.kind === "recording" && recording.current) {
      const rec = recording.current;
      recording.current = null;
      setVoice({ kind: "transcribing" });
      try {
        const audio = await rec.stop();
        const text = await transcribe(audio, (percent) => setVoice({ kind: "downloading", percent }), uiLanguage());
        setValue((v) => (v.trim() ? `${v.trim()} ${text}` : text));
        setVoice({ kind: "idle" });
        ref.current?.focus();
      } catch (e) {
        setVoice({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    if (voice.kind === "transcribing" || voice.kind === "downloading") return;
    try {
      recording.current = await startRecording();
      setVoice({ kind: "recording", since: Date.now() });
    } catch (e) {
      if (e instanceof Error && e.message === "permission") {
        askMicrophonePermission();
        setVoice({ kind: "error", message: "Allow the microphone in the tab that opened, then press the microphone again." });
      } else {
        setVoice({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
  };
  const voiceTitle = voice.kind === "recording" ? "Listening — click to stop"
    : voice.kind === "transcribing" ? "Turning your voice into text…"
    : voice.kind === "downloading" ? `Downloading the voice model, once (${voice.percent}%)`
    : "Speak instead of typing (stays on this computer)";

  const submit = () => {
    if (disabled || running || !value.trim()) return;
    onSend(value);
    setValue("");
  };

  const modeButton = (m: Mode, icon: React.ReactNode, title: string) => (
    <button
      type="button"
      disabled={running}
      onClick={() => onMode?.(m)}
      title={title}
      aria-pressed={mode === m}
      className={`rounded-md p-1.5 transition disabled:opacity-50 ${mode === m ? "bg-ink-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"}`}
    >
      {icon}
    </button>
  );

  return (
    <div className="relative px-3 pb-3 pt-1">
      {options.length > 0 && (
        <ul role="listbox" aria-label="Saved tasks and apps" className="absolute inset-x-3 bottom-full mb-1 overflow-hidden rounded-xl border border-ink-700 bg-ink-900 py-1 shadow-lg">
          {options.map((o, i) => (
            <li key={o.label} role="option" aria-selected={i === pick}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); choose(i); }}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs ${i === pick ? "bg-ink-800" : "hover:bg-ink-800"}`}>
                <span className="shrink-0 font-medium text-zinc-100">{o.label}</span>
                <span className="truncate text-zinc-500">{o.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-2xl border border-ink-700 bg-ink-900 px-3 pb-2 pt-2.5 transition focus-within:border-zinc-500/60">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={mode === "ask" ? "Ask anything…" : "Tell Enki what to do…"}
          aria-label="Message Enki"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (options.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPick((p) => (p + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                choose(Math.min(pick, options.length - 1));
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="block max-h-44 w-full resize-none bg-transparent text-sm leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-500 disabled:opacity-50"
        />
        <div className="mt-1.5 flex items-center gap-1">
          {onMode && (
            <div className="flex rounded-lg bg-ink-950/60 p-0.5">
              {modeButton("ask", <Search size={15} />, "Ask: Enki reads the page and answers")}
              {modeButton("act", <Monitor size={15} />, "Act: Enki can navigate, click and type")}
            </div>
          )}
          <button
            type="button"
            onClick={() => void toggleVoice()}
            disabled={disabled || running}
            title={voiceTitle}
            aria-label={voiceTitle}
            aria-pressed={voice.kind === "recording"}
            className={`rounded-md p-1.5 transition disabled:opacity-50 ${voice.kind === "recording" ? "animate-pulse bg-red-500/20 text-red-300" : "text-zinc-500 hover:text-zinc-200"}`}
          >
            {voice.kind === "transcribing" || voice.kind === "downloading" ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
          </button>
          {vision && (
            <button
              type="button"
              onClick={onToggleScreenshot}
              title={attachScreenshot ? "Screenshot attached to each message (click to turn off)" : "Screenshot off (click to attach)"}
              className={`rounded-md p-1.5 transition ${attachScreenshot ? "text-zinc-200 hover:bg-ink-800" : "text-zinc-500 hover:bg-ink-800 hover:text-zinc-300"}`}
            >
              {attachScreenshot ? <Camera size={15} /> : <CameraOff size={15} />}
            </button>
          )}
          <button
            type="button"
            onClick={onSettings}
            title="Settings"
            aria-label="Settings"
            className="ml-auto rounded-md p-1.5 text-zinc-500 transition hover:bg-ink-800 hover:text-zinc-200"
          >
            <SettingsIcon size={15} />
          </button>
          {running ? (
            <button type="button" onClick={onStop} title="Stop" aria-label="Stop"
              className="rounded-full bg-zinc-100 p-1.5 text-ink-950 transition hover:bg-zinc-300">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={disabled || !value.trim()} title="Send (Enter)" aria-label="Send"
              className="rounded-full bg-zinc-100 p-1.5 text-ink-950 transition hover:bg-zinc-300 disabled:bg-ink-800 disabled:text-zinc-500">
              <ArrowUp size={15} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
      {(voice.kind === "downloading" || voice.kind === "error") && (
        <p role="status" className="mt-1 px-1 text-[11px] text-zinc-400">
          {voice.kind === "downloading" ? `Downloading the voice model, once: ${voice.percent}%. After this, voice works offline.` : voice.message}
        </p>
      )}
    </div>
  );
}
