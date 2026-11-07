import { useState } from "react";
import { EMPTY_REALTIME, validateRealtime, realtimeCapability, type RealtimeConfig } from "../lib/voice/realtime";

export function RealtimeSettings({ value, onChange }: { value?: RealtimeConfig; onChange: (c: RealtimeConfig | undefined) => void }) {
  const c = value ?? EMPTY_REALTIME;
  const capability = realtimeCapability(c.protocol);
  const [message, setMessage] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const set = (k: keyof RealtimeConfig, v: string) => { setMessage(""); onChange({ ...c, [k]: v }); };
  return <section aria-label="Realtime Chat" className="mt-5 space-y-2 rounded-xl border border-ink-700 p-3">
    <h2 className="text-sm font-medium">Realtime Chat</h2>
    <p className="text-xs text-zinc-400">Separate voice configuration. No automatic fallback to your text provider. Capabilities depend on the selected wire protocol, not the provider name. An OpenAI-compatible chat API alone is not a realtime audio API.</p>
    <label className="block text-xs">Protocol<select aria-label="Realtime protocol" value={c.protocol} onChange={(e) => { onChange({ ...EMPTY_REALTIME, protocol: e.target.value as RealtimeConfig["protocol"] }); setEditingKey(false); setMessage("Protocol changed. Previous voice endpoint, models and credential cleared; no provider fallback. Save to apply."); }} className="mt-1 block w-full rounded bg-ink-950 p-2"><option value="openai-realtime-webrtc">OpenAI GA Realtime · WebRTC (implemented)</option><option value="nvidia-voicechat">NVIDIA Nemotron VoiceChat (not implemented)</option></select></label>
    {!capability.implemented && <div role="alert" className="rounded border border-amber-600 p-2 text-xs"><strong>{capability.label}</strong><p>{capability.reason}</p><p>The catalog advertises free serverless development APIs; the VoiceChat model card limits this to early-access evaluation, not unlimited production use. Portuguese support is not verified.</p><a href="https://build.nvidia.com/nvidia/nemotron-voicechat/modelcard" target="_blank" rel="noreferrer" className="underline">Official NVIDIA model card</a><p>Do not enter a key until the API contract is verified. Fields below can be saved for future setup, but saving does not enable an adapter or validate access. No default NVIDIA endpoint or model is invented.</p></div>}
    {([["provider", "Provider name"], ["endpoint", capability.implemented ? "Full HTTPS calls endpoint" : "Endpoint (unverified; not connected)"], ["model", "Realtime model"], ["transcriptionModel", "Transcription model"], ["voice", "Output voice"]] as const).map(([k, label]) =>
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
