import { audioDestination, validateRealtime, realtimeCapability, type RealtimeConfig } from "./realtime";

export function microphonePurpose(search: string): "dictation" | "realtime" | "invalid" {
  const p = new URLSearchParams(search);
  const values = p.getAll("purpose");
  if (!values.length) return "dictation"; // Existing permission-page bookmarks remain local dictation.
  return values.length === 1 && (values[0] === "dictation" || values[0] === "realtime") ? values[0] : "invalid";
}

/** Safe copy only. Never serialize config, credentials or raw endpoints into this page or URL. */
export function microphoneDisclosure(purpose: ReturnType<typeof microphonePurpose>, config?: RealtimeConfig) {
  if (purpose === "dictation") return {
    enabled: true, destination: "On this computer · dictation",
    description: "Dictation turns speech into text on this computer. Its audio is not sent to a provider. Granting permission here does not start dictation; return to Enki and press the dictation microphone.",
    next: "Return to Enki and press the dictation microphone. No recording has started.",
  };
  if (purpose === "realtime" && config && !validateRealtime(config)) {
    const provider = config.provider.replaceAll(config.credential, "[redacted]").slice(0, 160);
    return { enabled: true, destination: `${provider} · ${audioDestination(config)}`,
      description: "Realtime Chat is separate from local dictation. After you return and press Start voice, microphone audio leaves this computer for the configured provider and its negotiated media servers. Granting permission here sends no audio to that provider and does not start a connection.",
      next: "Return to Enki and press Start voice. No voice session has started.",
    };
  }
  return { enabled: false, destination: "Microphone off",
    description: purpose === "realtime" && config ? realtimeCapability(config.protocol).reason ?? "Realtime Chat isn’t configured. Return to Enki and review Settings." : "No usable microphone route is configured. Return to Enki and review Settings.",
    next: "Return to Enki and review Settings. No microphone or provider connection has started.",
  };
}
