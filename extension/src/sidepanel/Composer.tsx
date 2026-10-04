import { useEffect, useRef, useState } from "react";
import { ArrowUp, Camera, CameraOff, Monitor, Search, Settings as SettingsIcon, Square } from "lucide-react";
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
  onMode: (m: Mode) => void;
  onSettings: () => void;
};

export function Composer({ disabled, running, onSend, onStop, attachScreenshot, vision, onToggleScreenshot, mode, onMode, onSettings }: Props) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(Math.max(el.scrollHeight, 44), 180) + "px";
  }, [value]);

  const submit = () => {
    if (disabled || running || !value.trim()) return;
    onSend(value);
    setValue("");
  };

  const modeButton = (m: Mode, icon: React.ReactNode, title: string) => (
    <button
      type="button"
      disabled={running}
      onClick={() => onMode(m)}
      title={title}
      aria-pressed={mode === m}
      className={`rounded-md p-1.5 transition disabled:opacity-50 ${mode === m ? "bg-ink-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"}`}
    >
      {icon}
    </button>
  );

  return (
    <div className="px-3 pb-3 pt-1">
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
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="block max-h-44 w-full resize-none bg-transparent text-sm leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-500 disabled:opacity-50"
        />
        <div className="mt-1.5 flex items-center gap-1">
          <div className="flex rounded-lg bg-ink-950/60 p-0.5">
            {modeButton("ask", <Search size={15} />, "Ask: Enki reads the page and answers")}
            {modeButton("act", <Monitor size={15} />, "Act: Enki can navigate, click and type")}
          </div>
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
    </div>
  );
}
