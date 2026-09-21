import { createProvider } from ".";
import type { Settings } from "../settings";

export type Diagnostic = { label: string; state: "pass" | "fail" | "unknown"; detail: string };

/** A synthetic probe only: its tool is never passed to the browser executor. */
export async function diagnoseProvider(settings: Settings, signal: AbortSignal): Promise<Diagnostic[]> {
  const checks: Diagnostic[] = [];
  const provider = createProvider(settings);
  let answered = false;
  let called = false;
  try {
    for await (const ev of provider.stream({ model: settings.model,
      system: "Connection test. Call enki_connection_test with nonce enki-probe. Do not answer in prose.",
      messages: [{ role: "user", parts: [{ type: "text", text: "Call enki_connection_test now." }] }],
      tools: [{ name: "enki_connection_test", description: "A harmless diagnostic, not a browser action.",
        inputSchema: { type: "object", properties: { nonce: { type: "string", enum: ["enki-probe"] } }, required: ["nonce"], additionalProperties: false } }],
      maxTokens: 512, signal,
    })) {
      if (ev.type === "text_delta" && ev.text.trim() || ev.type === "thinking_delta" && ev.text.trim() || ev.type === "tool_call") answered = true;
      if (ev.type === "tool_call" && ev.call.name === "enki_connection_test" && ev.call.input.nonce === "enki-probe") called = true;
    }
    checks.push({ label: "Gateway", state: "pass", detail: "Endpoint responded." },
      { label: "Authentication", state: "pass", detail: "Chat request accepted with current credentials." },
      { label: "Selected model", state: answered ? "pass" : "fail", detail: answered ? "Model returned a response." : "Model returned no usable content." },
      { label: "Act tool support", state: called ? "pass" : "unknown", detail: called ? "Structured tool call verified. No browser action executed." : "Probe did not return the requested tool call. Act support is unverified." });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const auth = /\b(401|403)\b/.test(msg);
    const http = /\b([45]\d\d)\b/.exec(msg);
    const aborted = signal.aborted;

    let gatewayState: Diagnostic["state"];
    let gatewayDetail: string;
    if (aborted) {
      gatewayState = "unknown";
      gatewayDetail = "Probe cancelled or timed out before the gateway answered.";
    } else if (http) {
      // An HTTP error means the endpoint was reachable — auth/model rows explain the failure.
      gatewayState = "pass";
      gatewayDetail = `Endpoint reachable (HTTP ${http[1]}). Auth or model checks below explain the failure.`;
    } else {
      gatewayState = "fail";
      gatewayDetail = "Could not reach the endpoint. Check the base URL and that the gateway is running.";
    }

    checks.push(
      { label: "Gateway", state: gatewayState, detail: gatewayDetail },
      { label: "Authentication", state: auth ? "fail" : "unknown", detail: auth ? "Credentials rejected. Check the API key." : "Not verified." },
      { label: "Selected model", state: aborted ? "unknown" : "fail", detail: aborted ? "Probe cancelled or timed out." : "Request failed. Check model availability and gateway logs." },
      { label: "Act tool support", state: "unknown", detail: "Not verified." },
    );
  }
  return checks;
}