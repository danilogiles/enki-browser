import { useState } from "react";
import { EMPTY_REALTIME, validateRealtime, type RealtimeConfig } from "../lib/voice/realtime";

export function RealtimeSettings({ value, onChange }: { value?: RealtimeConfig; onChange: (c: RealtimeConfig | undefined) => void }) {
  const c = value ?? EMPTY_REALTIME;
  const [message, setMessage] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const set = (k: keyof RealtimeConfig, v: string) => { setMessage(""); onChange({ ...c, [k]: v }); };
  return <section aria-label="Realtime Chat" className="mt-5 space-y-2 rounded-xl border border-ink-700 p-3">
    <h2 className="text-sm font-medium">Realtime Chat</h2>
    <p className="text-xs text-zinc-400">Separate voice configuration. No automatic fallback to your text provider. Requires the OpenAI GA Realtime WebRTC calls protocol, not just an OpenAI-compatible chat API. NVIDIA VoiceChat and local speech pipelines are not supported by this adapter.</p>
    <label className="block text-xs">Protocol<select aria-label="Realtime protocol" value={c.protocol} onChange={() => set("protocol", "openai-realtime-webrtc")} className="mt-1 block w-full rounded bg-ink-950 p-2"><option value="openai-realtime-webrtc">OpenAI GA Realtime · WebRTC</option></select></label>
    {([["provider", "Provider name"], ["endpoint", "Full HTTPS calls endpoint"], ["model", "Realtime model"], ["transcriptionModel", "Transcription model"], ["voice", "Output voice"]] as const).map(([k, label]) =>
      <label key={k} className="block text-xs">{label}<input aria-label={label} value={c[k] ?? ""} onChange={(e) => set(k, e.target.value)} autoComplete="off" spellCheck={false} className="mt-1 block w-full rounded bg-ink-950 p-2" /></label>)}
    <label className="block text-xs">Realtime credential
      <input aria-label="Realtime credential" type="password" autoComplete="new-password" spellCheck={false}
        value={editingKey ? c.credential : ""} placeholder={c.credential && !editingKey ? "Saved credential · type to replace" : "Enter credential"}
        onChange={(e) => { setEditingKey(true); set("credential", e.target.value); }} className="mt-1 block w-full rounded bg-ink-950 p-2" />
    </label>
    <p className="text-xs text-zinc-400">Encrypted in this extension’s local storage, like AI provider keys. Never placed in a URL. Choose a provider you trust: Start voice sends microphone audio to its negotiated media servers. The existing Act provider separately receives page context. Transcripts follow Save conversations; no audio recording is saved.</p>
    <button type="button" className="rounded border border-ink-700 px-2 py-1 text-xs" onClick={() => setMessage(validateRealtime(c) ?? "Configuration valid locally. Authentication and audio are NOT tested. No network request or microphone use occurred; Start voice creates a potentially billable session.")}>Validate configuration (offline)</button>
    <button type="button" className="ml-2 text-xs underline" onClick={() => { onChange(undefined); setEditingKey(false); setMessage("Realtime Chat removed"); }}>Remove voice configuration</button>
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
