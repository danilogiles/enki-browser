// Mocked realtime transport + the real built extension and real Act loop in Chromium.
// No provider key, audio service or physical microphone is used by this suite.
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const dist = path.resolve('dist');
const context = await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(), 'enki-realtime-')), {
  headless: false, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`], viewport: { width: 440, height: 1000 },
});
let checks = 0;
const pass = (text) => { checks++; console.log('PASS', text); };
try {
  let [sw] = context.serviceWorkers(); if (!sw) sw = await context.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const panel = await context.newPage();
  await panel.addInitScript(() => {
    const v = window.__voiceTest = { mic: 0, requests: 0, stopped: 0, sent: [], channels: [] };
    window.Audio = class { muted = false; srcObject = null; play = async () => {}; pause() {} };
    navigator.mediaDevices.getUserMedia = async () => {
      v.mic++;
      const ctx = new AudioContext(); const track = ctx.createMediaStreamDestination().stream.getAudioTracks()[0];
      const stop = track.stop.bind(track); track.stop = () => { v.stopped++; stop(); void ctx.close(); };
      return new MediaStream([track]);
    };
    window.RTCPeerConnection = class {
      connectionState = 'connected';
      createDataChannel() {
        const channel = this.channel = { readyState: 'open', send: (s) => v.sent.push(JSON.parse(s)), close() { this.readyState = 'closed'; this.onclose?.(); } };
        v.channels.push(channel); return channel;
      }
      addTrack() {}
      addTransceiver() {}
      createOffer = async () => ({ type: 'offer', sdp: 'mock-offer' });
      setLocalDescription = async () => {};
      setRemoteDescription = async () => { this.channel.onmessage?.({ data: JSON.stringify({ type: 'session.created' }) }); };
      close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options) => {
      if (String(url).startsWith('https://voice.example.test/')) {
        v.requests++;
        if (v.deferProbe) return new Promise((resolve) => { v.releaseProbe = () => resolve(new Response('late-answer', { status: 201 })); });
        if (v.failProbe) return Promise.resolve(new Response('must-not-display-test-key', { status: 401 }));
        return Promise.resolve(new Response('mock-answer', { status: 201 }));
      }
      return originalFetch(url, options);
    };
    v.event = (e, index = v.channels.length - 1) => v.channels[index]?.onmessage?.({ data: JSON.stringify(e) });
    v.speak = (item_id, transcript) => { v.event({ type: 'input_audio_buffer.speech_started', item_id }); v.event({ type: 'conversation.item.input_audio_transcription.completed', item_id, transcript }); };
  });
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html`);
  await panel.evaluate(() => chrome.storage.local.set({ 'enki:settings': { preset: 'custom', baseUrl: 'http://127.0.0.1:8787/v1', apiKey: 'test', model: 'mock-agent', settingsVersion: 2, vision: false, autoApprove: false, saveConversations: false, theme: 'dark', maxSteps: 10 } }));
  const wid = await panel.evaluate(async () => (await chrome.windows.create({ url: 'http://127.0.0.1:8787/page', width: 900, height: 700 })).id);
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html?window=${wid}`);
  await panel.waitForSelector('textarea');
  await panel.getByRole('button', { name: 'Chat', exact: true }).click();
  await panel.getByText('Realtime Chat isn’t configured', { exact: true }).waitFor();
  assert.deepEqual(await panel.evaluate(() => [__voiceTest.mic, __voiceTest.requests]), [0, 0]); pass('unconfigured Chat warns without microphone/network');
  await mkdir('test-results', { recursive: true });
  await panel.screenshot({ path: 'test-results/realtime-unconfigured.png' });
  const voiceHeading = panel.getByRole('heading', { name: 'Realtime Chat', exact: true });
  await panel.getByRole('button', { name: 'Open settings', exact: true }).focus();
  await panel.keyboard.press('Enter');
  await panel.waitForFunction(() => document.activeElement?.id === 'realtime-settings-heading');
  const headingBox = await voiceHeading.boundingBox();
  assert.ok(headingBox && headingBox.y >= 0 && headingBox.y + headingBox.height <= 1000);
  await panel.keyboard.press('Tab');
  assert.equal(await panel.getByLabel('Realtime protocol', { exact: true }).evaluate((e) => e === document.activeElement), true);
  assert.deepEqual(await panel.evaluate(() => [__voiceTest.mic, __voiceTest.requests]), [0, 0]);
  pass('keyboard voice-settings deep link scrolls and focuses heading, then Tab reaches protocol without microphone/network');
  await panel.getByTitle('Back', { exact: true }).click();
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(await voiceHeading.evaluate((e) => e === document.activeElement), false);
  const generalBox = await voiceHeading.boundingBox();
  assert.ok(generalBox && generalBox.y > 1000);
  pass('ordinary Settings navigation does not inherit voice focus or scroll target');
  await panel.getByTitle('Back', { exact: true }).click();
  await panel.getByRole('button', { name: 'Open settings', exact: true }).click();
  await panel.waitForFunction(() => document.activeElement?.id === 'realtime-settings-heading');
  pass('reopening voice settings restores accessible target after ordinary Settings');
  for (const [label, text] of [['Provider name', 'Test voice provider'], ['Full HTTPS calls endpoint', 'https://voice.example.test/v1/realtime/calls'], ['Realtime model', 'configured-realtime'], ['Transcription model', 'configured-transcription'], ['Output voice', 'configured-voice'], ['Realtime credential', 'test-not-a-real-key']]) await panel.getByLabel(label, { exact: true }).fill(text);
  await panel.getByRole('button', { name: 'Validate configuration (offline)' }).click();
  await panel.getByText(/Configuration valid locally/).waitFor();
  assert.deepEqual(await panel.evaluate(() => [__voiceTest.mic, __voiceTest.requests]), [0, 0]); pass('configuration validation is offline and does not claim authentication');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal(await panel.getByRole('button', { name: 'Start voice', exact: true }).count(), 0);
  assert.deepEqual(await panel.evaluate(() => [__voiceTest.mic, __voiceTest.requests]), [0, 0]); pass('saved offline-only configuration cannot enable voice');
  await panel.getByRole('button', { name: 'Open settings', exact: true }).click();
  await panel.getByRole('button', { name: 'Test connection (no microphone)', exact: true }).click();
  await panel.getByText(/Connection verified; test session closed/).waitFor();
  assert.deepEqual(await panel.evaluate(() => [__voiceTest.mic, __voiceTest.requests]), [0, 1]); pass('explicit connection probe verifies protocol without microphone');
  await panel.getByLabel('Realtime model', { exact: true }).fill('new-model-with-no-fixed-list');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal(await panel.getByRole('button', { name: 'Start voice', exact: true }).count(), 0); pass('editing a tested model invalidates availability');
  await panel.getByRole('button', { name: 'Open settings', exact: true }).click();
  await panel.evaluate(() => __voiceTest.deferProbe = true);
  await panel.getByRole('button', { name: 'Test connection (no microphone)', exact: true }).click();
  await panel.waitForFunction(() => __voiceTest.requests === 2);
  await panel.getByLabel('Realtime model', { exact: true }).fill('another-new-model');
  await panel.evaluate(() => { __voiceTest.deferProbe = false; __voiceTest.releaseProbe(); });
  assert.equal(await panel.getByText(/Connection verified; test session closed/).count(), 0); pass('editing cancels pending probe and ignores its late result');
  await panel.evaluate(() => __voiceTest.failProbe = true);
  await panel.getByRole('button', { name: 'Test connection (no microphone)', exact: true }).click();
  await panel.getByText(/Connection test failed/).waitFor();
  assert.ok(!(await panel.locator('body').innerText()).includes('must-not-display-test-key'));
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal(await panel.getByRole('button', { name: 'Start voice', exact: true }).count(), 0); pass('failed authentication is redacted and leaves voice unavailable');
  await panel.getByRole('button', { name: 'Open settings', exact: true }).click();
  await panel.evaluate(() => __voiceTest.failProbe = false);
  await panel.getByRole('button', { name: 'Test connection (no microphone)', exact: true }).click();
  await panel.getByText(/Connection verified; test session closed/).waitFor();
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await panel.waitForSelector('textarea');
  assert.ok(await panel.evaluate(async () => (await chrome.storage.local.get('enki:settings'))['enki:settings'].realtime.credential.startsWith('enc:v1:'))); pass('voice credential encrypted in local storage');
  await panel.getByRole('button', { name: 'Start voice', exact: true }).waitFor();
  assert.deepEqual(await panel.evaluate(() => [__voiceTest.mic, __voiceTest.requests]), [0, 4]); pass('configured Chat selection still inert');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(await panel.getByLabel('Realtime credential', { exact: true }).inputValue(), '');
  pass('saved voice credential is not rendered into the Settings DOM');
  await panel.getByLabel('Realtime credential', { exact: true }).scrollIntoViewIfNeeded();
  await panel.screenshot({ path: 'test-results/realtime-settings.png' });
  await panel.getByTitle('Back', { exact: true }).click();
  await panel.getByRole('button', { name: 'Start voice', exact: true }).click();
  await panel.waitForFunction(() => document.body.innerText.includes('listening · Say Stop'));
  await panel.evaluate(() => __voiceTest.event({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'x', delta: 'Buy now' }));
  assert.equal(await panel.locator('button:has-text("Allow")').count(), 0); pass('interim transcript cannot act');
  await panel.evaluate(() => __voiceTest.speak('one', 'Search for hello and buy it'));
  await panel.getByRole('button', { name: 'Allow', exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await panel.evaluate(() => __voiceTest.sent.filter((e) => e.type === 'response.create').length), 0); pass('voice request runs real Act and pauses at existing sensitive approval');
  // Audio saying yes cannot resolve the pending trusted-UI approval.
  await panel.evaluate(() => __voiceTest.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'unknown', transcript: 'yes' }));
  assert.equal(await panel.getByRole('button', { name: 'Allow', exact: true }).count(), 1); pass('spoken yes does not authorize approval');
  await panel.screenshot({ path: 'test-results/realtime-confirmation.png' });
  await panel.getByRole('button', { name: 'Allow', exact: true }).click();
  await panel.waitForFunction(() => __voiceTest.sent.some((e) => e.type === 'response.create'), null, { timeout: 30000 });
  const target = await panel.evaluate(async (windowId) => {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ title: document.title, value: document.querySelector('#q')?.value }) });
    return result.result;
  }, wid);
  assert.equal(target.title, 'BOUGHT:hello enki'); assert.equal(target.value, 'hello enki'); pass('committed speech reaches browser action and completed answer is sent for audio generation');
  await panel.getByRole('button', { name: 'Mute', exact: true }).click();
  assert.equal(await panel.evaluate(() => __voiceTest.stopped), 1); pass('Mute physically stops capture and closes transport');
  await panel.getByRole('button', { name: 'More', exact: true }).click();
  await panel.getByTitle('New chat', { exact: true }).click();
  await panel.getByRole('button', { name: 'Start voice', exact: true }).click();
  await panel.waitForFunction(() => __voiceTest.mic === 2 && document.body.innerText.includes('listening · Say Stop'));
  await panel.evaluate(() => __voiceTest.speak('two', 'Search for hello and buy it'));
  await panel.getByRole('button', { name: 'Allow', exact: true }).waitFor({ timeout: 30000 });
  await panel.evaluate(() => __voiceTest.speak('three', 'Stop'));
  await panel.getByRole('button', { name: 'Start voice', exact: true }).waitFor();
  await panel.waitForFunction(() => !document.querySelector('button[title="Stop"]'));
  assert.equal(await panel.getByRole('button', { name: 'Allow', exact: true }).count(), 0);
  assert.equal(await panel.evaluate(() => __voiceTest.stopped), 2); pass('spoken Stop aborts real pending approval and stops microphone');
  const responses = await panel.evaluate(() => __voiceTest.sent.filter((e) => e.type === 'response.create').length);
  await panel.evaluate(() => __voiceTest.speak('late', 'Open another page'));
  await panel.waitForTimeout(300);
  assert.equal(await panel.evaluate(() => __voiceTest.sent.filter((e) => e.type === 'response.create').length), responses); pass('late events after Stop cannot restart actions/output');
  await panel.screenshot({ path: 'test-results/realtime-stopped.png' });
  await panel.locator("button[title^='Act:']").click();
  await panel.locator("button[aria-label^='Speak instead']").click();
  await panel.locator("button[aria-label^='Listening']").waitFor();
  await panel.getByRole('button', { name: 'Chat', exact: true }).click();
  await panel.waitForFunction(() => __voiceTest.mic === 3 && __voiceTest.stopped === 3);
  pass('selecting Chat disposes the separate local dictation recorder');
  const beforeNvidia = await panel.evaluate(() => [__voiceTest.mic, __voiceTest.requests]);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByLabel('Realtime protocol').selectOption('nvidia-voicechat');
  assert.equal(await panel.getByLabel('Realtime credential', { exact: true }).inputValue(), '');
  assert.equal(await panel.getByLabel('Endpoint (unverified; not connected)', { exact: true }).inputValue(), '');
  await panel.getByRole('button', { name: 'Validate configuration (offline)' }).click();
  await panel.getByText(/NVIDIA VoiceChat is not implemented/).first().waitFor();
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await panel.getByText('NVIDIA Nemotron VoiceChat · integration blocked', { exact: true }).waitFor();
  assert.equal(await panel.getByRole('button', { name: 'Start voice', exact: true }).count(), 0);
  assert.deepEqual(await panel.evaluate(() => [__voiceTest.mic, __voiceTest.requests]), beforeNvidia);
  pass('NVIDIA capability selection clears prior key and endpoint, reports blocked status and never falls back');
  await panel.screenshot({ path: 'test-results/nvidia-capability-blocked.png' });

} finally { await context.close(); }
console.log(`${checks} mocked realtime UI checks passed. Live provider and physical microphone smoke NOT run.`);
