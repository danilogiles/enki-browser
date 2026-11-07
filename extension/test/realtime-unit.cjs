const ts = require('typescript');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, f);
const { RealtimeVoice, EMPTY_REALTIME, validateRealtime, audioDestination } = require('../src/lib/voice/realtime.ts');
const { runTurn } = require('../src/lib/agent/loop.ts');
const config = { provider: 'Chosen provider', protocol: 'openai-realtime-webrtc', endpoint: 'https://voice.example.test/v1/realtime/calls',
  model: 'user-chosen-realtime-model', transcriptionModel: 'user-chosen-transcription-model', voice: 'user-chosen-voice', credential: 'test-credential-not-real' };
const tick = () => new Promise((r) => setImmediate(r));
function deferred() { let resolve; const promise = new Promise((r) => resolve = r); return { promise, resolve }; }
function harness(options = {}) {
  const sent = [], states = [], notices = [], transcripts = [], acts = [], requests = [];
  let micCalls = 0, peerCalls = 0, stopped = 0, remoteStopped = 0;
  const track = { stop: () => stopped++ };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const audio = { muted: false, paused: false, srcObject: { getTracks: () => [{ stop: () => remoteStopped++ }] }, play: async () => {}, pause() { this.paused = true; } };
  const channel = { readyState: 'open', send: (e) => sent.push(JSON.parse(e)), close() { this.readyState = 'closed'; this.onclose?.(); } };
  const peer = { connectionState: 'connected', createDataChannel: () => channel, addTrack() {},
    createOffer: async () => ({ type: 'offer', sdp: 'mock-sdp' }), setLocalDescription: async () => {},
    setRemoteDescription: async () => {}, close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); } };
  const voice = new RealtimeVoice(options.config ?? config, {
    state: (s) => states.push(s), notice: (s) => notices.push(s), transcript: (role, text) => transcripts.push({ role, text }),
    act: async (text, signal) => { acts.push({ text, signal }); return options.act ? options.act(text, signal) : 'Completed safely'; },
  }, { peer: () => { peerCalls++; return peer; }, audio: () => audio,
    microphone: () => { micCalls++; return options.microphone ?? Promise.resolve(stream); },
    fetch: async (...args) => { requests.push(args); if (options.fetch) return options.fetch(...args); return new Response('mock-answer', { status: 201 }); },
  });
  const event = (e) => channel.onmessage?.({ data: JSON.stringify(e) });
  const speak = (id, text) => { event({ type: 'input_audio_buffer.speech_started', item_id: id }); event({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text }); };
  const start = async () => { await voice.start(); event({ type: 'session.created' }); };
  return { voice, start, event, speak, sent, states, notices, transcripts, acts, requests, audio, peer, channel, stream,
    counts: () => ({ micCalls, peerCalls, stopped, remoteStopped }) };
}

test('missing config, protocols, credentials, HTTPS endpoint validation are offline and redacted', async () => {
  assert.ok(validateRealtime(undefined)); assert.ok(validateRealtime(EMPTY_REALTIME));
  assert.equal(validateRealtime(config), null);
  for (const patch of [ { protocol: 'generic-openai' }, { endpoint: 'http://localhost/calls' }, { endpoint: 'wss://voice.test' },
    { endpoint: 'https://user:pass@voice.test' }, { endpoint: 'https://voice.test?key=x' }, { endpoint: 'https://voice.test/#key' },
    { credential: 'a\nb' }, { credential: 'a b' }, { model: '' }, { transcriptionModel: '' }, { voice: '' },
    { endpoint: `https://voice.test/${config.credential}` } ]) {
    const error = validateRealtime({ ...config, ...patch }); assert.ok(error); assert.ok(!error.includes(config.credential));
  }
  assert.equal(audioDestination(config), 'https://voice.example.test');
  const h = harness({ config: EMPTY_REALTIME }); await h.voice.start();
  assert.equal(h.counts().micCalls, 0); assert.equal(h.counts().peerCalls, 0); assert.equal(h.requests.length, 0);
});

test('construction/select is inert; only Start connects with header auth, redirect refusal and configured models', async () => {
  const h = harness(); assert.equal(h.counts().micCalls, 0); assert.equal(h.requests.length, 0);
  await h.start();
  assert.equal(h.counts().micCalls, 1); assert.equal(h.requests.length, 1);
  const [url, request] = h.requests[0]; assert.equal(url, config.endpoint); assert.ok(!url.includes(config.credential));
  assert.equal(request.headers.Authorization, `Bearer ${config.credential}`);
  assert.equal(request.redirect, 'error'); assert.equal(request.credentials, 'omit'); assert.equal(request.referrerPolicy, 'no-referrer');
  const session = JSON.parse(request.body.get('session'));
  assert.equal(session.model, config.model); assert.equal(session.audio.input.transcription.model, config.transcriptionModel);
  assert.equal(session.audio.output.voice, config.voice); assert.equal(session.audio.input.turn_detection.create_response, false);
  assert.deepEqual(session.tools, []); assert.equal(session.tool_choice, 'none');
  h.voice.end();
});

test('interim speech, remote tools, unknown/stale transcripts cannot act; committed utterance acts once and speaks answer', async () => {
  const h = harness(); await h.start();
  h.event({ type: 'response.function_call_arguments.done', name: 'click', arguments: '{}' });
  h.event({ type: 'conversation.item.input_audio_transcription.delta', item_id: '1', delta: 'click' });
  h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'unknown', transcript: 'click' });
  await tick(); assert.equal(h.acts.length, 0);
  h.speak('1', 'Read the current page'); await tick();
  h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: '1', transcript: 'Read the current page' });
  await tick(); assert.equal(h.acts.length, 1); assert.equal(h.acts[0].text, 'Read the current page');
  assert.equal(h.transcripts.at(-1).text, 'Completed safely');
  const response = h.sent.find((e) => e.type === 'response.create').response;
  assert.equal(response.conversation, 'none'); assert.deepEqual(response.tools, []);
  assert.match(response.input[0].content[0].text, /Completed safely/);
  h.voice.end();
});

test('Mute and End stop actual tracks, clear buffers, cancel actions, reject late events and never reconnect', async () => {
  for (const method of ['mute', 'end']) {
    const done = deferred(); const h = harness({ act: () => done.promise }); await h.start();
    h.speak('1', 'Open a page'); await tick(); assert.equal(h.acts.length, 1);
    h.voice[method](); assert.equal(h.acts[0].signal.aborted, true);
    assert.equal(h.counts().stopped, 1); assert.equal(h.counts().remoteStopped, 1);
    assert.equal(h.audio.srcObject, null); assert.equal(h.audio.paused, true); assert.equal(h.audio.muted, true);
    assert.equal(h.channel.readyState, 'closed'); assert.equal(h.peer.connectionState, 'closed');
    assert.ok(h.sent.some((e) => e.type === 'input_audio_buffer.clear'));
    h.speak('late', 'Do another action'); done.resolve('Late answer'); await tick();
    assert.equal(h.acts.length, 1); assert.equal(h.sent.filter((e) => e.type === 'response.create').length, 0);
    await h.voice.start(); assert.equal(h.requests.length, 1);
  }
});

test('spoken Stop ends voice, cancels an in-flight action, and prevents pending work', async () => {
  const done = deferred(); const h = harness({ act: () => done.promise }); await h.start();
  h.speak('1', 'First task'); await tick(); h.speak('2', 'Second task queued'); h.speak('3', 'Stop.');
  assert.equal(h.acts[0].signal.aborted, true); done.resolve('Finished old task'); await tick();
  assert.equal(h.acts.length, 1); assert.equal(h.states.at(-1), 'ended');
  assert.equal(h.sent.filter((e) => e.type === 'response.create').length, 0);
});

test('barge-in clears output, cancels Act and serializes the next utterance without duplicating', async () => {
  const h = harness(); await h.start(); h.speak('1', 'First'); await tick();
  h.speak('2', 'Second'); await tick();
  assert.ok(h.sent.some((e) => e.type === 'response.cancel'));
  assert.ok(h.sent.some((e) => e.type === 'output_audio_buffer.clear'));
  assert.equal(h.acts[0].signal.aborted, true); assert.equal(h.acts.length, 2);
  h.voice.end();
});

test('End while microphone permission is pending stops late-granted tracks without connecting', async () => {
  const granted = deferred(); const h = harness({ microphone: granted.promise });
  const starting = h.voice.start(); h.voice.end(); granted.resolve(h.stream); await starting;
  assert.equal(h.counts().stopped, 1); assert.equal(h.requests.length, 0);
});

test('provider failure is redacted and disconnected; no silent fallback', async () => {
  const h = harness({ fetch: async () => { throw new Error(config.credential + ' secret body'); } }); await h.start();
  assert.equal(h.counts().stopped, 1); assert.equal(h.requests.length, 1);
  assert.ok(!h.notices.join().includes(config.credential)); assert.ok(!h.notices.join().includes('secret body'));
  assert.equal(h.states.at(-1), 'error');
});

test('disconnect aborts pending Act and ignores every subsequent callback', async () => {
  const done = deferred(); const h = harness({ act: () => done.promise }); await h.start();
  h.speak('1', 'task'); await tick(); h.peer.connectionState = 'disconnected'; h.peer.onconnectionstatechange();
  assert.equal(h.acts[0].signal.aborted, true); h.speak('2', 'late'); done.resolve('late'); await tick();
  assert.equal(h.acts.length, 1); assert.equal(h.states.at(-1), 'error');
});

const call = { type: 'tool_call', id: 'c1', name: 'click', input: { ref: 'ref_1' } };
function loopOptions(signal, prepare, approval) {
  return { provider: { async *stream() { yield { type: 'tool_call', call }; yield { type: 'done', stopReason: 'tool_use' }; } },
    model: 'mock', mode: 'act', system: '', history: [{ role: 'user', parts: [{ type: 'text', text: 'click' }] }],
    tools: [{ name: "click", description: "click", inputSchema: {} }], executor: { prepare, release: async () => {} }, maxSteps: 1, autoApprove: false,
    signal, requestApproval: approval ?? (async () => true), onEvent: () => {} };
}
test('existing Act loop: interruption during async prepare never executes the prepared action', async () => {
  const controller = new AbortController(); let runs = 0, prepared = 0;
  await runTurn(loopOptions(controller.signal, async () => { prepared++; controller.abort(); return { label: 'click', sensitive: false, run: async () => { runs++; return { content: [] }; } }; }));
  assert.equal(prepared, 1); assert.equal(runs, 0);
});
test('existing sensitive approval requires trusted UI; Stop racing approval cannot execute even approved action', async () => {
  const controller = new AbortController(); let approvals = 0, runs = 0;
  await runTurn(loopOptions(controller.signal, async () => ({ label: 'sensitive click', sensitive: true,
    run: async () => { runs++; return { content: [] }; } }), async () => { approvals++; controller.abort(); return true; }));
  assert.equal(approvals, 1); assert.equal(runs, 0);
});

test('source invariants: Chat reuses Act loop and fences, has no remote executor or spoken approval path', () => {
  const app = fs.readFileSync(require.resolve('../src/sidepanel/App.tsx'), 'utf8');
  assert.match(app, /voice \? "act"/); assert.match(app, /voice\?\.signal\.addEventListener\("abort", cancelVoice/);
  assert.match(app, /fenceInline/); assert.match(app, /requestApproval, stopForOtherWindow/);
  assert.match(app, /autoApprove: voice \? false : settings.autoApprove/);
  assert.match(app, /intent === "normal" && !voice/);
  const voice = fs.readFileSync(require.resolve('../src/lib/voice/realtime.ts'), 'utf8');
  assert.ok(!voice.includes('chrome.scripting')); assert.ok(!voice.includes('BrowserExecutor'));
  const ui = fs.readFileSync(require.resolve('../src/sidepanel/RealtimeSettings.tsx'), 'utf8');
  assert.match(ui, /value=\{editingKey \? c.credential : ""\}/);
});


test('separate realtime credential is encrypted/decrypted through settings and absent from diagnostics', async () => {
  const secrets = require('../src/lib/secrets.ts');
  const settings = require('../src/lib/settings.ts');
  const { diagnosticReport } = require('../src/lib/diagnostics.ts');
  const oldEncrypt = secrets.encrypt, oldDecrypt = secrets.decrypt, oldChrome = global.chrome;
  let stored = {};
  secrets.encrypt = async (s) => s ? `enc:v1:${s}` : '';
  secrets.decrypt = async (s) => s.replace(/^enc:v1:/, '');
  global.chrome = { runtime: { getManifest: () => ({ version: 'test' }) }, storage: { local: {
    get: async () => stored, set: async (s) => { stored = { ...stored, ...s }; },
  } } };
  try {
    await settings.saveSettingsFromUi({ ...settings.DEFAULT_SETTINGS, apiKey: 'text-only-test', realtime: config });
    const raw = stored[settings.SETTINGS_KEY];
    assert.equal(raw.realtime.credential, 'enc:v1:' + config.credential);
    assert.equal(raw.apiKey, ''); assert.equal(raw.apiKeys.nvidia, 'enc:v1:text-only-test');
    const loaded = await settings.loadSettings(); assert.deepEqual(loaded.realtime, config);
    assert.ok(!diagnosticReport(loaded).includes(config.credential));
    assert.ok(!diagnosticReport(loaded).includes(config.endpoint));
    const malformed = settings.migrateSettings({ realtime: { ...config, arbitrary: 'do-not-copy' } }).settings;
    assert.equal(malformed.realtime.arbitrary, undefined);
  } finally { secrets.encrypt = oldEncrypt; secrets.decrypt = oldDecrypt; global.chrome = oldChrome; }
});

test('voice connected to the real Act loop completes a tool and reads the resulting answer, without remote tools', async () => {
  let browserActions = 0, modelSteps = 0;
  const h = harness({ act: async (_text, signal) => {
    const history = [{ role: 'user', parts: [{ type: 'text', text: 'click the safe control' }] }];
    const o = loopOptions(signal, async () => ({ label: 'safe click', sensitive: false,
      run: async () => { browserActions++; return { content: [{ type: 'text', text: 'clicked' }] }; } }));
    o.history = history; o.maxSteps = 2;
    o.provider = { async *stream() {
      if (modelSteps++ === 0) { yield { type: 'tool_call', call }; yield { type: 'done', stopReason: 'tool_use' }; }
      else { yield { type: 'text_delta', text: 'The control is clicked.' }; yield { type: 'done', stopReason: 'end_turn' }; }
    } };
    await runTurn(o);
    return history.at(-1).parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
  } });
  await h.start(); h.speak('1', 'click the safe control'); await tick();
  assert.equal(browserActions, 1); assert.equal(modelSteps, 2);
  assert.equal(h.transcripts.at(-1).text, 'The control is clicked.');
  assert.ok(h.sent.find((e) => e.type === 'response.create').response.input[0].content[0].text.includes('The control is clicked.'));
  h.voice.end();
});


test('channel send exceptions during cancellation never prevent microphone disposal', async () => {
  const h = harness(); await h.start(); h.speak('1', 'read'); await tick();
  h.channel.send = () => { throw new Error('closed between state check and send'); };
  h.voice.end(); assert.equal(h.counts().stopped, 1); assert.equal(h.audio.srcObject, null);
  assert.equal(h.states.at(-1), 'ended');
});


test('microphone denial contacts no provider and leaves no active peer', async () => {
  const h = harness({ microphone: Promise.reject(new Error('permission denied')) }); await h.start();
  assert.equal(h.requests.length, 0); assert.equal(h.peer.connectionState, 'closed');
  assert.equal(h.states.at(-1), 'error');
});

test('HTTP authentication failure never displays provider body or retries another endpoint', async () => {
  const h = harness({ fetch: async () => new Response('echoed ' + config.credential, { status: 401 }) }); await h.start();
  assert.equal(h.requests.length, 1); assert.ok(!h.notices.join().includes(config.credential));
  assert.equal(h.counts().stopped, 1); assert.equal(h.states.at(-1), 'error');
});


test('a real committed spoken yes cannot approve a sensitive action through the Act bridge', async () => {
  let approvals = 0, runs = 0;
  const h = harness({ act: async (_text, signal) => {
    await runTurn(loopOptions(signal, async () => ({ label: 'Delete', sensitive: true,
      run: async () => { runs++; return { content: [] }; } }), async () => {
        approvals++; return new Promise((resolve) => {
          if (signal.aborted) resolve(false); else signal.addEventListener('abort', () => resolve(false), { once: true });
        });
      }));
  } });
  await h.start(); h.speak('one', 'Delete the item'); await tick(); assert.equal(approvals, 1);
  h.speak('two', 'yes'); await tick(); assert.equal(runs, 0);
  assert.equal(approvals, 2); // It can request another card, not resolve it as approved.
  h.voice.end(); await tick(); assert.equal(runs, 0);
});
