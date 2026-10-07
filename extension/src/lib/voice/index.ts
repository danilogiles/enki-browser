/**
 * Voice input: record from the microphone, transcribe on this device (worker.ts), return text.
 *
 * The side panel cannot show Chromium's microphone prompt itself, so the first time the panel is
 * refused, a small tab of Enki's (src/mic/index.html) asks; once allowed there, the permission
 * belongs to the extension and the panel records directly.
 */

export type VoiceState =
  | { kind: "idle" }
  | { kind: "recording"; since: number }
  | { kind: "downloading"; percent: number }
  | { kind: "transcribing" }
  | { kind: "error"; message: string };

let worker: Worker | null = null;

function getWorker(): Worker {
  worker ??= new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  return worker;
}

/** Whisper takes 16 kHz mono samples. */
async function toSamples(blob: Blob): Promise<Float32Array> {
  const data = await blob.arrayBuffer();
  const decoded = await new AudioContext().decodeAudioData(data);
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}

export type Recording = { stop: () => Promise<Float32Array>; cancel: () => void };

/** Starts recording; throws "permission" when the microphone was not granted. */
export async function startRecording(): Promise<Recording> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const name = (e as DOMException)?.name;
    throw new Error(name === "NotAllowedError" || name === "SecurityError" ? "permission" : (e as Error).message);
  }
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
  recorder.start();
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () => new Promise<Float32Array>((resolve, reject) => {
      recorder.onstop = () => { release(); toSamples(new Blob(chunks, { type: recorder.mimeType })).then(resolve, reject); };
      recorder.stop();
    }),
    cancel: () => { recorder.onstop = null; if (recorder.state !== "inactive") recorder.stop(); release(); },
  };
}

/** Transcribes 16 kHz samples; `onProgress` reports the one-time model download. */
export function transcribe(audio: Float32Array, onProgress: (percent: number) => void, language?: string): Promise<string> {
  const w = getWorker();
  const files = new Map<string, { loaded: number; total: number }>();
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "progress" && m.file && m.total) {
        files.set(m.file, { loaded: m.loaded ?? 0, total: m.total });
        const sum = [...files.values()].reduce((a, f) => ({ loaded: a.loaded + f.loaded, total: a.total + f.total }), { loaded: 0, total: 0 });
        onProgress(Math.min(99, Math.round((sum.loaded / sum.total) * 100)));
        return;
      }
      w.removeEventListener("message", onMessage);
      if (m.type === "text") resolve(m.text);
      else if (m.type === "error") reject(new Error(m.message));
    };
    w.addEventListener("message", onMessage);
    w.postMessage({ type: "transcribe", audio, language }, [audio.buffer]);
  });
}

/** Opens Enki's microphone permission page in a tab. */
export function askMicrophonePermission(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL("src/mic/index.html") });
}

/** The two-letter language of the browser's UI, as a hint to Whisper (it still detects). */
export function uiLanguage(): string | undefined {
  const lang = (navigator.language || "").slice(0, 2).toLowerCase();
  return ["pt", "es", "en", "fr", "de", "it"].includes(lang) ? lang : undefined;
}
