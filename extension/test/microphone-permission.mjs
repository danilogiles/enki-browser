// Real permission-page bundle, mocked getUserMedia. No actual microphone or provider is used.
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const dist = path.resolve('dist');
const context = await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(), 'enki-mic-route-')), {
  headless: false, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let checks = 0;
const pass = (text) => { checks++; console.log('PASS', text); };
try {
  let [sw] = context.serviceWorkers(); if (!sw) sw = await context.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__permissionTest = { captured: 0, stopped: 0, providerRequests: 0 };
    navigator.mediaDevices.getUserMedia = async () => {
      __permissionTest.captured++; return { getTracks: () => [{ stop: () => __permissionTest.stopped++ }] };
    };
    window.fetch = async () => { __permissionTest.providerRequests++; throw new Error('No provider request permitted'); };
  });
  const outside = [];
  page.on('request', (r) => { if (/^https?:/.test(r.url())) outside.push(r.url()); });
  await page.goto(`chrome-extension://${id}/src/mic/index.html?purpose=dictation`);
  await page.locator('#grant:enabled').waitFor();
  assert.equal(await page.evaluate(() => __permissionTest.captured), 0);
  assert.match(await page.locator('#description').innerText(), /audio is not sent to a provider/);
  pass('dictation permission page has local-only copy and no automatic capture');
  await page.locator('#grant').click();
  await page.waitForFunction(() => __permissionTest.stopped === 1);
  assert.match(await page.locator('#status').innerText(), /dictation microphone/);
  pass('dictation permission click stops tracks and does not start recording');
  const config = { provider: 'Configured voice destination', protocol: 'openai-realtime-webrtc', endpoint: 'https://voice.example.test/v1/realtime/calls', model: 'configured-model', transcriptionModel: 'configured-transcriber', voice: 'configured-voice', credential: 'test-not-real-voice-credential' };
  await page.evaluate(async (realtime) => chrome.storage.local.set({ 'enki:settings': { preset: 'custom', apiKey: 'test', baseUrl: 'https://text.example.test/v1', model: 'mock', settingsVersion: 2, realtime } }), config);
  await page.goto(`chrome-extension://${id}/src/mic/index.html?purpose=realtime`);
  await page.locator('#grant:enabled').waitFor();
  assert.equal(await page.evaluate(() => __permissionTest.captured), 0);
  const body = await page.locator('body').innerText();
  assert.match(body, /audio leaves this computer/); assert.match(body, /voice\.example\.test/);
  assert.ok(!body.includes(config.credential)); assert.ok(!body.includes('/v1/realtime/calls'));
  assert.ok(!body.includes('audio is never sent anywhere'));
  assert.equal(await page.evaluate(() => __permissionTest.providerRequests), 0);
  pass('realtime permission page discloses safe configured destination, not local-only privacy');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/mic-realtime-permission.png' });
  await page.locator('#grant').click();
  await page.waitForFunction(() => __permissionTest.stopped === 1);
  assert.match(await page.locator('#status').innerText(), /press Start voice/);
  assert.equal(await page.evaluate(() => __permissionTest.providerRequests), 0);
  pass('realtime permission click only grants/stops mic; return requires explicit Start voice');
  await page.evaluate(async () => {
    const all = await chrome.storage.local.get('enki:settings'); const settings = all['enki:settings'];
    await chrome.storage.local.set({ 'enki:settings': { ...settings, realtime: { ...settings.realtime, protocol: 'nvidia-voicechat', provider: 'NVIDIA' } } });
  });
  await page.reload(); await page.getByText(/NVIDIA VoiceChat is not implemented/).waitFor();
  assert.equal(await page.locator('#grant').isDisabled(), true);
  assert.equal(await page.evaluate(() => __permissionTest.captured), 0);
  pass('unimplemented NVIDIA route cannot request mic permission or connect');
  await page.goto(`chrome-extension://${id}/src/mic/index.html?purpose=invalid`);
  await page.getByText(/No usable microphone route/).waitFor();
  assert.equal(await page.locator('#grant').isDisabled(), true); assert.equal(await page.evaluate(() => __permissionTest.captured), 0);
  assert.deepEqual(outside, []);
  pass('unknown route fails closed and permission flows make no external requests');
} finally { await context.close(); }
console.log(`${checks} microphone permission route checks passed (mocked microphone).`);
