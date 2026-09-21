// Load the dependency-free TypeScript core without adding a test runner dependency.
// Uses the `typescript` devDependency at runtime, so this runs from a checkout after
// `npm install` — not from a packaged release.
const ts = require('typescript');
const fs = require('node:fs');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { budgetHistory, estimateTokens, repairInterruptedHistory } = require('../src/lib/agent/context.ts');
const { snapshotConversation, restoreConversation } = require('../src/lib/conversation.ts');
const { diagnosticReport } = require('../src/lib/diagnostics.ts');
const { log } = require('../src/lib/debug.ts');
const { runTurn } = require('../src/lib/agent/loop.ts');
const { DEFAULT_SETTINGS } = require('../src/lib/settings.ts');
global.chrome = { runtime: { getManifest: () => ({ version: 'test' }) } };
const user = (text) => ({ role: 'user', parts: [{ type: 'text', text }] });
const call = { type: 'tool_call', id: 'c1', name: 'click', input: { ref: 'ref_1' } };
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS', name); }

check('summary stays within budget and keeps complete tool exchanges', () => {
  const h = [];
  for (let i = 0; i < 30; i++) h.push(user('request ' + i + 'x'.repeat(3000)), { role: 'assistant', parts: [{ ...call, id: 'c' + i }] },
    { role: 'tool', parts: [{ type: 'tool_result', name: 'click', toolCallId: 'c' + i, content: [{ type: 'text', text: 'ok' }] }] });
  h.push(user('latest task'));
  assert.ok(budgetHistory(h, 6000) > 0);
  assert.ok(estimateTokens(h) <= 6000);
  assert.equal(h.at(-1).parts[0].text, 'latest task');
  for (let i = 0; i < h.length; i++) if (h[i].role === 'assistant') assert.equal(h[i + 1].parts[0].toolCallId, h[i].parts[0].id);
});
check('interrupted tool batches receive missing results without duplicating existing ones', () => {
  const h = [user('task'), { role: 'assistant', parts: [call, { ...call, id: 'c2' }] }, { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c1', name: 'click', content: [] }] }];
  repairInterruptedHistory(h); repairInterruptedHistory(h);
  assert.equal(h[2].parts.length, 2);
  assert.match(h[2].parts[1].content[0].text, /Outcome unknown/);
});
check('restore strips screenshots, stops pending actions, and does not change live history', () => {
  const h = [user('task'), { role: 'assistant', parts: [call] }];
  h[0].parts.push({ type: 'image', data: 'SECRET_IMAGE', mediaType: 'image/png' });
  const snapshot = snapshotConversation(h, [{ id: 'x', role: 'assistant', streaming: true, thinking: 'SECRET_REASONING', segments: [{ kind: 'tool', id: 'c1', name: 'click', label: 'click', status: 'awaiting' }] }]);
  const restored = restoreConversation(snapshot);
  assert.equal(restored.messages[0].streaming, false);
  assert.equal(restored.messages[0].segments[0].status, 'error');
  assert.ok(!JSON.stringify(restored).includes('SECRET'));
  assert.equal(h.length, 2);
  assert.equal(h[0].parts[1].data, 'SECRET_IMAGE');
});
check('diagnostic export excludes secrets embedded in raw error strings and arguments', () => {
  log.error('provider', 'HTTP 401 SECRET_KEY https://secret.example', { error: 'SECRET_BODY', input: 'SECRET_PROMPT', messages: 4 });
  const report = diagnosticReport({ ...DEFAULT_SETTINGS, apiKey: 'SECRET_KEY', baseUrl: 'https://SECRET_URL' });
  assert.ok(!report.includes('SECRET'));
  assert.ok(report.includes('HTTP 401'));
  assert.ok(report.includes('"messages": 4'));
});

(async () => {
  const events = [];
  let executions = 0;
  const options = {
    provider: { async *stream() { yield { type: 'tool_call', call: { ...call, id: String(Math.random()) } }; yield { type: 'done', stopReason: 'tool_use' }; } },
    model: 'test', mode: 'act', system: '', history: [user('task')], tools: [{ name: 'click' }], maxSteps: 10, autoApprove: false,
    signal: new AbortController().signal, requestApproval: async () => true,
    onEvent: (e) => events.push(e),
    executor: { prepare: async () => ({ label: 'click', sensitive: false, run: async () => { executions++; return { content: [{ type: 'text', text: 'failed' }], isError: true }; } }), release: async () => {} },
  };
  await runTurn(options);
  check('three identical failures stop the loop with a truthful summary', () => {
    assert.equal(executions, 3);
    assert.equal(events.at(-1).reason, 'repeated_failure');
    assert.equal(events.find((e) => e.type === 'summary').failed, 3);
  });
  executions = 0;
  await runTurn({ ...options, mode: 'ask', history: [user('read only')], tools: [{ name: 'read_page' }] });
  check('read-only recovery cannot execute a modifying tool even if the model emits one', () => assert.equal(executions, 0));

  const refreshed = [];
  await runTurn({
    ...options, mode: 'ask', refreshPage: true, history: [user('continue')], tools: [{ name: 'read_page' }],
    provider: { async *stream() { yield { type: 'text_delta', text: 'the page is loaded' }; yield { type: 'done', stopReason: 'end_turn' }; } },
    executor: { prepare: async () => ({ label: 'Read page', sensitive: false, run: async () => ({ content: [{ type: 'text', text: 'page' }], isError: false }) }), release: async () => {} },
    onEvent: (e) => refreshed.push(e),
  });
  check("Continue's own page refresh is shown but not counted as the model's work", () => {
    assert.equal(refreshed.filter((e) => e.type === 'tool_result').length, 1);
    assert.equal(refreshed.find((e) => e.type === 'summary').succeeded, 0);
    assert.equal(refreshed.find((e) => e.type === 'summary').outcome, 'finished');
  });

  const truncated = [];
  await runTurn({
    ...options, history: [user('write something long')], maxOutputTokens: 1024,
    provider: { async *stream() { yield { type: 'text_delta', text: 'a long answer' }; yield { type: 'done', stopReason: 'max_tokens' }; } },
    onEvent: (e) => truncated.push(e),
  });
  check('a reply cut off by the output cap says so instead of ending silently', () =>
    assert.match(truncated.find((e) => e.type === 'notice').message, /1024-token output cap/));
  console.log(`${checks}/${checks} checks passed`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
