import { useEffect, useRef, useState, type Ref } from "react";
import { EMPTY_REALTIME, validateRealtime, realtimeCapability, type RealtimeConfig } from "../lib/voice/realtime";

import { testRealtimeConnection } from "../lib/voice/connection-test";

export function RealtimeSettings({ value, onChange, headingRef }: { value?: RealtimeConfig; onChange: (c: RealtimeConfig | undefined) => void; headingRef?: Ref<HTMLHeadingElement> }) {
  const c = value ?? EMPTY_REALTIME;
  const capability = realtimeCapability(c.protocol);
  const [message, setMessage] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const probe = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current++; probe.current?.abort(); }, []);
  const cancel = () => { epoch.current++; probe.current?.abort(); probe.current = null; setTesting(false); };
  const set = (k: keyof RealtimeConfig, v: string) => { cancel(); setMessage(""); onChange({ ...c, [k]: v, connectionVerified: false }); };
  const test = async () => {
    cancel();
    const invalid = validateRealtime(c);
    onChange({ ...c, connectionVerified: false });
    if (invalid) { setMessage(invalid); return; }
    const id = epoch.current;
    const controller = new AbortController(); probe.current = controller;
    setTesting(true); setMessage("Testing connection without microphone, playback or browser actions…");
    const result = await testRealtimeConnection(c, controller.signal);
    if (id !== epoch.current) return;
    probe.current = null; setTesting(false); setMessage(result.message);
    onChange({ ...c, connectionVerified: result.ok });
  };
  return <section aria-labelledby="realtime-settings-heading" className="mt-5 space-y-2 rounded-xl border border-ink-700 p-3">
    <h2 id="realtime-settings-heading" ref={headingRef} tabIndex={-1} className="scroll-mt-3 rounded text-sm font-medium focus:outline focus:outline-2 focus:outline-enki-400">Realtime Chat</h2>
    <p className="text-xs text-zinc-400">Optional Live Voice Chat. Provider, endpoint and model names are editable, not a fixed model list. No automatic fallback to your text provider. Capabilities depend on the selected wire protocol, not the provider name. An OpenAI-compatible chat API alone is not a realtime audio API.</p>
    <label className="block text-xs">Protocol<select aria-label="Realtime protocol" value={c.protocol} onChange={(e) => { cancel(); onChange({ ...EMPTY_REALTIME, protocol: e.target.value as RealtimeConfig["protocol"] }); setEditingKey(false); setMessage("Protocol changed. Previous voice endpoint, models and credential cleared; no provider fallback. Save to apply."); }} className="mt-1 block w-full rounded bg-ink-950 p-2"><option value="openai-realtime-webrtc">OpenAI GA Realtime · WebRTC (implemented)</option><option value="nvidia-voicechat">NVIDIA Nemotron VoiceChat (not implemented)</option></select></label>
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
    <p className="text-xs text-zinc-400">Supported now: OpenAI GA Realtime WebRTC calls protocol, including compatible services. A text-only OpenAI-compatible endpoint is not enough. New model names using this protocol do not need an app update.</p>
    <p className="text-xs text-zinc-400">Test connection sends these settings and your credential to {validateRealtime(c) ? "the configured HTTPS endpoint" : new URL(c.endpoint).origin}, then negotiates WebRTC with that provider. It may incur provider charges and expose network connection metadata. No microphone audio, playback or page content is used. A passing connection test does not prove working audio.</p>
    <button type="button" disabled={testing || !capability.implemented} className="rounded border border-ink-700 px-2 py-1 text-xs disabled:opacity-50" onClick={() => void test()}>Test connection (no microphone)</button>
    {testing && <button type="button" className="ml-2 text-xs underline" onClick={() => { cancel(); setMessage("Connection test cancelled"); }}>Cancel connection test</button>}
    <p className="text-xs text-zinc-400">{c.connectionVerified ? "Connection tested. Save to make Start voice available; microphone starts only when you click it." : "Not connection-tested. Voice stays unavailable until the connection test passes and you save. Changing any field requires another test."}</p>
    <button type="button" className="ml-2 text-xs underline" onClick={() => { cancel(); onChange(undefined); setEditingKey(false); setMessage("Realtime Chat removed"); }}>Remove voice configuration</button>
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
