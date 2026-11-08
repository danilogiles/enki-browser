# NVIDIA VoiceChat integration assessment — not implemented

Scope clarification, November 8, 2026: Live Voice Chat is optional and protocol-based, with editable
provider/endpoint/model/key. NVIDIA is an optional future adapter, not a mandatory release gate
for the generic feature. No NVIDIA support is implied by a successful different-protocol test.

This is a capability/access assessment, **not** a working adapter or a claim that NVIDIA has no
streaming API. Selecting NVIDIA in Settings deliberately blocks Start voice before microphone,
transport or provider creation. There is no silent OpenAI fallback. Changing protocol clears the
old voice endpoint, models and key; no guessed NVIDIA endpoint, token scheme or model is filled in.

## What the official sources establish

| Offering | Verified public facts | What must not be inferred |
| --- | --- | --- |
| [NVIDIA catalog](https://build.nvidia.com/explore/speech) | “Free serverless APIs for development”; lists Nemotron VoiceChat as speech-to-speech | Not a promise of unlimited, permanent or production-free VoiceChat access |
| [Nemotron 3 VoiceChat model card](https://build.nvidia.com/nvidia/nemotron-voicechat/modelcard) | 12B full-duplex S2S; 16 kHz input, 22.05 kHz output; “ready for early access evaluation purposes only”; NVIDIA API Trial Service Terms and Software/Model Evaluation License | No hosted WebRTC calls contract, websocket authentication scheme, model selection, browser token flow, committed-event/cancellation contract or Portuguese guarantee is specified on the reviewed card |
| [Hosted demo page](https://build.nvidia.com/nvidia/nemotron-voicechat) | Full-duplex demo; recommends headphones and good internet; trial/privacy terms apply | The demo's own internal traffic is not a supported integration API and was not inspected |
| [NVIDIA NemotronLabs VoiceChat 11B](https://huggingface.co/nvidia/NVIDIA-NemotronLabs-VoiceChat-11B) | A separately released 11B checkpoint with function calling; interactive deployment links to NVIDIA's optimized container | This is not proof that the older hosted 12B trial has the same protocol/authentication or model ID |
| [Official container API](https://github.com/NVIDIA-NeMo/Speech/blob/nemotron-labs-voicechat/voicechat_realtime_instructions/api-reference.md) | Public WebSocket protocol at `/v1/realtime` or `/realtime`; JSON, base64 PCM16 little-endian mono, 24 kHz input/output, recommended 80 ms chunks; server resamples internally | Not the GA WebRTC multipart `/realtime/calls` protocol. “OpenAI compatible” here does not mean Enki's GA adapter can connect |

### The public container API really exists, but is a different adapter

The documented client messages are `session.update`, `input_audio_buffer.append`,
`conversation.item.create` **function-call output**, and `session.close`. The reference exposes
completed user transcription and model function-call events. It explicitly says unknown session
fields (including `turn_detection` and `voice`) are silently ignored; instructions apply to the first
inference only. It does not document Enki's current `response.create`, `response.cancel` or output
buffer-clear semantics. Its public reference also does not specify a browser authentication flow.
No authentication scheme was invented or borrowed from NVIDIA's different realtime-ASR API.

[Container deployment](https://github.com/NVIDIA-NeMo/Speech/blob/nemotron-labs-voicechat/voicechat_realtime_instructions/deploy.md)
and [prerequisites](https://github.com/NVIDIA-NeMo/Speech/blob/nemotron-labs-voicechat/voicechat_realtime_instructions/prerequisites.md)
require Linux/x86_64 and an NVIDIA GPU with at least **80 GB VRAM** (the deployment guide mentions
approximately 66 GB model memory). We did not download/deploy a GPU container or buy hardware or
compute. Self-hosting is not the hosted free-trial API the user wants.

### Portuguese

The hosted VoiceChat card reviewed here does not publish a supported-language list. The official
11B sample system prompt asks for conversations **in English**, and the checkpoint page requires
ASCII-only system prompts/tool results. This is evidence of the documented English path, not proof
that Portuguese can never work. **Portuguese S2S support is unverified and must not be advertised.**
Other catalog ASR/TTS models advertise multilingual support; that does not establish it for VoiceChat.

## Concrete blockers and a safe integration path

1. **Hosted trial contract/access:** obtain an NVIDIA-published hosted connection URL/protocol,
   authentication or short-lived browser token flow, model/voice selection and permission to use
   that API externally. The reviewed public demo/model card does not provide that contract. This
   is distinct from merely lacking a key; supplying a key alone does not establish the protocol.
   No account, trial, acceptance of terms or paid resource was created.
2. **Separate transport:** implement only the actually documented contract. For the container this
   needs bounded PCM24k streaming capture/playback, session.updated readiness, committed-utterance
   correlation and deduplication, and explicit server-close behavior. Do not send GA WebRTC events
   to it or claim unsupported fields changed a server model or voice.
3. **Authentication boundary:** remote transport must be HTTPS/WSS. Browser WebSocket cannot add
   arbitrary Authorization headers. If NVIDIA requires those headers, use only its documented
   ephemeral-token flow or a separately reviewed first-party/native relay with fixed destination,
   no redirect/token leakage and no generic credential-forwarding capability. Never put long-lived
   keys in URLs, subprotocols or page contexts; never expose an unauthenticated remote microphone API.
   The existing Enki extension has no approved native voice relay, so none was improvised here.
4. **Act bridge:** completed current user utterances remain the only source of browser requests.
   Any remote function-call arguments are untrusted and must not dispatch BrowserExecutor directly
   or expand permissions. A distinct adapter must correlate a bounded agent-delegation result to
   the current committed turn, guard page text as data, preserve trusted-UI confirmations and block
   passwords/payments. Model-generated speech cannot confirm actions.
5. **Cancellation:** because the documented container contract lacks GA cancel/clear operations,
   assess fail-closed socket/audio disposal and fresh explicit restart for interruption. No stale
   tool result/audio may cross a new turn/session. Do not merely ignore a cancel message server-side.
6. **Validation:** actual authorized account/server and real mic/audio smoke, interruption/network-loss
   tests, language verification, trial quotas/retention review, CI and Cloak/Blink/Ink review before enabling.

## What this change delivers

- A truthful NVIDIA capability selection marked **not implemented / integration blocked**.
- Offline validation and session guards prove selecting it never opens mic/network or falls back.
- A purpose-specific microphone permission page: realtime copy shows the configured safe destination
  and says audio leaves this computer after Start voice; dictation copy remains local-only. Loading
  either page does not capture audio. Permission requires its own explicit button, tracks stop
  immediately afterwards, and the page sends nothing to a provider. The user returns to Enki and
  explicitly presses Start voice. Unimplemented/invalid routes cannot request permission.

Only **OpenAI GA Realtime WebRTC** is implemented in this branch, validated with mocked transport.
No NVIDIA or OpenAI live provider, real microphone or audible playback validation is claimed.

## Follow-up research — 2026-11-07

The [official NeMo Labs hosted NIM/Riva guide](https://docs.nvidia.com/nemo/labs-voice-agent/build-voice-agents/model-serving/nvidia-nim-riva)
documents a separate cascaded NVIDIA voice pipeline: hosted ASR and TTS over TLS gRPC
(`grpc.nvcf.nvidia.com:443`, API key plus deployment function IDs), with an OpenAI-compatible
text LLM endpoint. The Python/Pipecat server mediates the browser transport. It is not the
hosted Nemotron VoiceChat speech-to-speech trial, and does not establish that trial's browser
connection/authentication contract. No server, account, trial or relay was deployed.

This is a documented candidate for NVIDIA-powered voice, not delivered support. Enki would
need a separately reviewed native/first-party transport boundary for gRPC, explicit destination
and credential handling, cancellation and reconnect deduplication, and a decision on the
cascaded experience versus full-duplex VoiceChat. Do not silently substitute it or advertise
its evaluation limits as the VoiceChat trial's limits. The guide also notes the sample's
language-setting limitation (effective default en-US), so Portuguese remains unverified.

Re-read the VoiceChat model card and container API reference during this follow-up. The
model card still describes early-access evaluation without an external hosted session contract;
the container reference documents PCM24k WebSocket sessions but no browser authentication
flow or GA response-cancellation operations. Public integration reports found during research
concern self-hosted serving, not proof of a hosted free-trial integration.
