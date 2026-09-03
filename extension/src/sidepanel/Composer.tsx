import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, SendHorizontal, Square } from "lucide-react";
import type { Mode } from "../lib/agent/prompt";

type Props = {
  disabled: boolean;
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  attachScreenshot: boolean;
  onToggleScreenshot: () => void;
  mode: Mode;
  usage: { input: number; output: number };
};

export function Composer({ disabled, running, onSend, onStop, attachScreenshot, onToggleScreenshot, mode, usage }: Props) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [value]);

  const submit = () => {
    if (disabled || running || !value.trim()) return;
    onSend(value);
    setValue("");
  };

  return (
    <div className="border-t border-ink-700 px-3 pb-3 pt-2">
      <div className="flex items-end gap-2 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 focus-within:border-enki-500/60">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={mode === "ask" ? "Ask about this page…" : "What should I do on this page?"}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-40 flex-1 resize-none bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={onToggleScreenshot}
          title={attachScreenshot ? "Screenshot attached to each message (click to turn off)" : "Screenshot off (click to attach)"}
          className={`rounded-md p-1.5 transition ${attachScreenshot ? "text-enki-400 hover:bg-ink-800" : "text-zinc-500 hover:bg-ink-800 hover:text-zinc-300"}`}
        >
          {attachScreenshot ? <Camera size={16} /> : <CameraOff size={16} />}
        </button>
        {running ? (
          <button
            type="button"
            onClick={onStop}
            title="Stop"
            className="rounded-md bg-red-500/20 p-1.5 text-red-300 transition hover:bg-red-500/30"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !value.trim()}
            title="Send (Enter)"
            className="rounded-md bg-enki-500 p-1.5 text-ink-950 transition hover:bg-enki-400 disabled:opacity-40"
          >
            <SendHorizontal size={16} />
          </button>
        )}
      </div>
      <div className="mt-1 flex justify-between px-1 text-[10px] text-zinc-600">
        <span>{mode === "act" ? "Act mode: Enki can click and type. Sensitive actions ask first." : "Ask mode: read-only."}</span>
        {usage.input + usage.output > 0 && (
          <span title="Tokens this conversation (in / out)">
            {fmt(usage.input)} / {fmt(usage.output)} tok
          </span>
        )}
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
