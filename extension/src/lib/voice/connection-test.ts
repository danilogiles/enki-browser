import { realtimeSession, validateRealtime, type RealtimeConfig } from "./realtime";

type ProbeEnvironment = { peer: () => RTCPeerConnection; fetch: typeof fetch; timeoutMs?: number };
const browser: ProbeEnvironment = { peer: () => new RTCPeerConnection(), fetch: (...args) => fetch(...args) };
export type ConnectionTestResult = { ok: boolean; message: string };

/** Explicit, short-lived authentication/protocol test, NOT an audio or Act test.
 * No getUserMedia, audio element, page context, browser tools or generated response.
 * A recvonly transceiver negotiates the audio protocol without sending microphone audio.
 * Never display provider responses/SDP/exceptions; they may echo credentials.
 */
export function testRealtimeConnection(config: RealtimeConfig, signal: AbortSignal,
  env: ProbeEnvironment = browser): Promise<ConnectionTestResult> {
  const invalid = validateRealtime(config);
  if (invalid) return Promise.resolve({ ok: false, message: invalid });
  if (signal.aborted) return Promise.resolve({ ok: false, message: "Connection test cancelled" });
  return new Promise((resolve) => {
    let done = false;
    let peer: RTCPeerConnection | undefined;
    let channel: RTCDataChannel | undefined;
    const lifetime = new AbortController();
    const finish = (ok: boolean, message: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      lifetime.abort();
      try { channel?.close(); } catch { /* disposal must continue */ }
      try { peer?.close(); } catch { /* do not display transport exceptions */ }
      resolve({ ok, message });
    };
    const cancel = () => finish(false, "Connection test cancelled");
    const failure = () => finish(false, "Connection test failed. Check the supported protocol, endpoint, model, voice and credential. No microphone or provider fallback was used.");
    const timer = setTimeout(() => finish(false, "Connection test timed out. No microphone was used. Retry explicitly."), env.timeoutMs ?? 20000);
    signal.addEventListener("abort", cancel, { once: true });
    void (async () => {
      try {
        peer = env.peer();
        peer.ontrack = (event) => event.track.stop();
        peer.onconnectionstatechange = () => {
          if (["failed", "closed", "disconnected"].includes(peer!.connectionState)) failure();
        };
        peer.addTransceiver("audio", { direction: "recvonly" });
        channel = peer.createDataChannel("oai-events");
        channel.onerror = failure;
        channel.onclose = failure;
        channel.onmessage = (event) => {
          if (done || typeof event.data !== "string" || event.data.length > 131072) return;
          try {
            const e = JSON.parse(event.data);
            if (e.type === "error") failure();
            else if (e.type === "session.created") finish(true, "Connection verified; test session closed. Microphone, playback and browser actions are NOT tested. Save, then use Start voice to test audio explicitly.");
          } catch { failure(); }
        };
        const offer = await peer.createOffer();
        if (done) return;
        await peer.setLocalDescription(offer);
        if (done) return;
        const body = new FormData();
        body.set("sdp", offer.sdp ?? "");
        body.set("session", JSON.stringify(realtimeSession(config)));
        const response = await env.fetch(config.endpoint.trim(), {
          method: "POST", headers: { Authorization: `Bearer ${config.credential.trim()}` },
          body, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", signal: lifetime.signal,
        });
        if (done) return;
        if (!response.ok) { failure(); return; }
        const sdp = await response.text();
        if (done) return;
        await peer.setRemoteDescription({ type: "answer", sdp });
        // HTTP success alone is not verification. Wait for the protocol's session.created event.
      } catch { if (!done) failure(); }
    })();
  });
}
