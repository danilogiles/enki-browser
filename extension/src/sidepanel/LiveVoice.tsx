import { useEffect, useRef, useState } from "react";
import { RealtimeVoice, audioDestination, validateRealtime, type RealtimeConfig, type RealtimeState } from "../lib/voice/realtime";
import { askMicrophonePermission } from "../lib/voice";

export function LiveVoice({ config, act, disabled, onSettings, onSession }: {
  config?: RealtimeConfig; act: (text: string, signal: AbortSignal) => Promise<string | undefined>;
  disabled: boolean; onSettings: () => void; onSession: (session: RealtimeVoice | null) => void;
}) {
  const [state, setState] = useState<RealtimeState>("ended");
  const [notice, setNotice] = useState("");
  const [transcript, setTranscript] = useState<Array<{ role: string; text: string }>>([]);
  const session = useRef<RealtimeVoice | null>(null);
  const actRef = useRef(act); actRef.current = act;
  // Closing settings/mode/panel must synchronously invalidate queued work and stop the mic.
  useEffect(() => () => { session.current?.end(); onSession(null); }, [config, onSession]);
  const invalid = validateRealtime(config);
  const live = ["connecting", "listening", "working", "speaking"].includes(state);
  const start = () => {
    if (live || disabled || invalid || !config) return;
    setNotice(""); setTranscript([]);
    session.current?.end();
    const voice = new RealtimeVoice(config, {
      state: setState, notice: setNotice,
      transcript: (role, text) => setTranscript((old) => [...old.slice(-9), { role, text }]),
      act: (text, signal) => actRef.current(text, signal),
    });
    session.current = voice; onSession(voice); void voice.start();
  };
  return <section aria-label="Live voice" className="mx-3 mb-2 rounded-xl border border-cyan-600/40 bg-ink-900 p-3 text-xs">
    <h2 className="font-medium text-cyan-200">Chat · Live voice</h2>
    {invalid ? <div role="alert"><p className="mt-2">Realtime Chat isn’t configured</p><p>Open Settings → Model Provider Setup → Realtime Chat. Enter a protocol, provider, endpoint, model, transcription model, voice and credential.</p><button className="mt-2 underline" onClick={onSettings}>Open settings</button></div> : <>
      <p className="mt-2 break-words">Audio destination: {config!.provider} · {audioDestination(config!)}. Microphone audio leaves this computer for that provider’s negotiated WebRTC media servers.</p>
      <details open={!live} className="mt-1 text-zinc-400"><summary className="cursor-pointer">Permissions and data flow</summary>
      <p className="mt-1">Chat can act in this browser under the same Act permissions; it is not Auto. Page context goes to your existing AI provider, and the final answer also goes to the voice provider for speech. Sensitive actions require an on-screen click, key or tap — never spoken approval. Passwords and payments stay blocked. Page playback is not authorization; use headphones. Speaker identity cannot be verified.</p>
      <p className="mt-1 text-zinc-400">Mic off until Start voice. No audio recording saved. Transcripts follow Save conversations. Mute disconnects and discards buffered audio; Start voice resumes with a new session. Sessions may incur provider charges.</p></details>
      <p role="status" className="mt-2 font-medium">{state === "ended" ? "Mic off" : state === "muted" ? "Muted · microphone stopped" : state} · Say Stop to interrupt</p>
      <div className="mt-2 flex flex-wrap gap-3">
        {!live && <button disabled={disabled} className="rounded bg-cyan-300 px-3 py-1 text-ink-950 disabled:opacity-50" onClick={start}>Start voice</button>}
        {live && <><button onClick={() => session.current?.mute()} className="rounded border px-3 py-1">Mute</button><button onClick={() => session.current?.end()} className="rounded border px-3 py-1">Stop / End</button></>}
      </div>
    </>}
    {notice && <p role="alert" className="mt-2">{notice}</p>}
    {state === "error" && <button onClick={askMicrophonePermission} className="mt-2 underline">Open microphone permission page (no provider connection)</button>}
    {!!transcript.length && <ol aria-label="Voice transcript" aria-live="polite" className="mt-2 max-h-32 overflow-auto">{transcript.map((line, i) => <li key={i} className="mt-1 whitespace-pre-wrap"><strong>{line.role === "user" ? "You" : "Enki"}: </strong>{line.text}</li>)}</ol>}
  </section>;
}
