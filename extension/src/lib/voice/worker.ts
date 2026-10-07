/**
 * Speech to text on this device: Whisper running in a worker, so the panel stays responsive while
 * it thinks. The audio never leaves the browser. The model is downloaded once, from Hugging Face,
 * the first time voice is used, and kept in the browser's cache from then on.
 *
 * onnxruntime's WebAssembly runtime is bundled into the extension by Vite (an extension may not
 * run code it downloads); it uses WebGPU when the computer has it, else the CPU, single-threaded
 * because extension pages are not cross-origin isolated.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import ortMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

export const MODEL = "onnx-community/whisper-base";

env.allowLocalModels = false;
env.useBrowserCache = true;
// Its WASM cache re-imports the runtime from a blob: URL inside a worker (where `chrome` is not
// defined, so it does not know it is in an extension). The CSP refuses that; the runtime is already
// a local file here, so there is nothing to cache.
env.useWasmCache = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  // Left unset, transformers.js points onnxruntime at jsDelivr and imports the runtime from a blob:
  // URL, both of which the extension's CSP refuses (and the first would be remote code). These are
  // the copies Vite ships inside the extension.
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL(ortMjs, self.location.href).href,
    wasm: new URL(ortWasm, self.location.href).href,
  };
}

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  asr ??= pipeline("automatic-speech-recognition", MODEL, {
    device: "wasm",
    dtype: "q8",
    progress_callback: (p: { status: string; file?: string; progress?: number; loaded?: number; total?: number }) => {
      if (p.status === "progress") postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total });
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  return asr;
}

self.onmessage = async (e: MessageEvent<{ type: "transcribe"; audio: Float32Array; language?: string } | { type: "warm" }>) => {
  try {
    const model = await load();
    if (e.data.type === "warm") { postMessage({ type: "ready" }); return; }
    // Chunking is only for audio longer than Whisper's 30 s window; on a short clip its overlapping
    // stride repeated the last phrase.
    const long = e.data.audio.length > 30 * 16000;
    const out = await model(e.data.audio, {
      task: "transcribe",
      language: e.data.language,
      ...(long ? { chunk_length_s: 30, stride_length_s: 5 } : {}),
    });
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim();
    postMessage({ type: "text", text });
  } catch (err) {
    asr = null;
    postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
