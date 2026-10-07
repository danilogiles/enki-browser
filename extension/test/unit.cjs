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
const { toTextProtocol } = require('../src/lib/providers/text-tools.ts');
const { extractTextToolCalls } = require('../src/lib/agent/toolcall-text.ts');
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

  let asked = 0;
  const internal = [];
  await runTurn({
    ...options, refreshPage: true, history: [user('go to example.com')], tools: [{ name: 'read_page' }, { name: 'navigate' }],
    executor: { ...options.executor, prepare: async () => ({ label: 'read', sensitive: false, run: async () => ({ content: [{ type: 'text', text: 'This tab (chrome://newtab/) is a browser-internal page' }], isError: true }) }) },
    provider: { async *stream() { asked++; yield { type: 'text_delta', text: 'You are on a new tab.' }; yield { type: 'done', stopReason: 'end_turn' }; } },
    onEvent: (e) => internal.push(e),
  });
  check('an unreadable page during refresh still reaches the model instead of ending the turn', () => {
    assert.equal(asked, 1);
    assert.ok(!internal.some((e) => e.type === 'error'));
    assert.equal(internal.at(-1).reason, 'end_turn');
  });

  check('compatibility mode carries instructions, tools and results as plain chat text', () => {
    const req = toTextProtocol({
      model: 'm', system: 'SYSTEM_RULES', tools: [{ name: 'click', description: 'Click it', inputSchema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] } }],
      messages: [user('task'), { role: 'assistant', parts: [{ type: 'text', text: 'on it' }, call] },
        { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c1', name: 'click', content: [{ type: 'text', text: 'CLICKED' }] }] }, user('next')],
    });
    assert.equal(req.system, '');
    assert.equal(req.tools.length, 0);
    assert.deepEqual(req.messages.map((m) => m.role), ['user', 'assistant', 'user']);
    const first = req.messages[0].parts.map((p) => p.text).join('');
    assert.ok(first.includes('SYSTEM_RULES') && first.includes('- click: Click it') && first.includes('- ref: string'));
    assert.ok(req.messages[1].parts[0].text.includes('{"tool":"click","arguments":{"ref":"ref_1"}}'));
    const last = req.messages[2].parts.map((p) => p.text).join('');
    assert.ok(last.includes('[Result of click]\nCLICKED') && last.includes('next') && /JSON block/.test(last));
    assert.ok(!JSON.stringify(req.messages).includes('"role":"tool"'));
  });
  check('a call written in compatibility-mode JSON is recovered; a foreign one is not', () => {
    const allowed = new Set(['navigate']);
    const ok = extractTextToolCalls('Going.\n```json\n{"tool": "navigate", "arguments": {"url": "https://example.com"}}\n```', allowed);
    assert.equal(ok.calls.length, 1);
    assert.deepEqual(ok.calls[0].input, { url: 'https://example.com' });
    assert.equal(ok.cleaned, 'Going.');
    const bad = extractTextToolCalls('{"tool": "mcp__puppeteer__click", "arguments": {}}', allowed);
    assert.equal(bad.calls.length, 0);
  });
  const { parseNumber, dataFromTable, dataFromSpec, parseMindmap } = require('../src/lib/visual-data.ts');
  check('numbers are read the way people write them', () => {
    assert.equal(parseNumber('1.234.567'), 1234567);
    assert.equal(parseNumber('1,234,567.5'), 1234567.5);
    assert.equal(parseNumber('45,6%'), 45.6);
    assert.equal(parseNumber('R$ 2.300'), 2300);
    assert.equal(parseNumber('1.234'), 1234);
    assert.equal(parseNumber('3.25'), 3.25);
    assert.equal(parseNumber('-7'), -7);
    assert.equal(parseNumber('Lula'), null);
    assert.equal(parseNumber(''), null);
  });
  check('a table with numbers becomes chart data; one without does not', () => {
    const d = dataFromTable(['Candidato', 'Votos', '%'], [['A', '1.000', '50,5'], ['B', '900', '45,5']]);
    assert.deepEqual(d.labels, ['A', 'B']);
    assert.deepEqual(d.series.map((s) => s.data), [[1000, 900], [50.5, 45.5]]);
    assert.equal(dataFromTable(['Name', 'Role'], [['A', 'x'], ['B', 'y']]), null);
    assert.equal(dataFromTable(['A', 'B'], [['x', '1']]), null); // one row is not a chart
  });
  check('chart blocks are read, and half-streamed ones are ignored', () => {
    const d = dataFromSpec('{"type":"pie","labels":["a","b"],"series":[{"name":"s","data":[1,"2,5"]}]}');
    assert.equal(d.type, 'pie');
    assert.deepEqual(d.series[0].data, [1, 2.5]);
    assert.equal(dataFromSpec('{"type":"bar","labels":["a"'), null);
  });
  check('mind map lists become a tree', () => {
    const t = parseMindmap('Launch\n- Product\n  - Pricing\n  - Docs\n- Marketing\n  - Blog');
    assert.equal(t.label, 'Launch');
    assert.deepEqual(t.children.map((c) => c.label), ['Product', 'Marketing']);
    assert.deepEqual(t.children[0].children.map((c) => c.label), ['Pricing', 'Docs']);
  });
  check('a long task trims its oldest tool results instead of stopping', () => {
    const { trimToolResults } = require('../src/lib/agent/context.ts');
    const result = (id, n) => ({ role: 'tool', parts: [{ type: 'tool_result', name: 'read_url', toolCallId: id, content: [{ type: 'text', text: 'x'.repeat(n) }] }] });
    const h = [user('read three pages')];
    for (let i = 0; i < 3; i++) h.push({ role: 'assistant', parts: [{ ...call, id: 'r' + i, name: 'read_url' }] }, result('r' + i, 15000));
    assert.ok(estimateTokens(h) > 12000);
    assert.ok(trimToolResults(h, 12000) > 0);
    assert.ok(estimateTokens(h) <= 12000);
    assert.equal(h[h.length - 1].parts[0].content[0].text.length, 15000); // the newest stays whole
    assert.match(h[2].parts[0].content[0].text, /cut to fit the context budget/);
  });
  check('saved tasks and @apps expand at the start of a message', () => {
    const { expand, suggestions } = require('../src/lib/shortcuts.ts');
    const tasks = [{ id: '1', name: 'Daily Standup', prompt: 'List my open tickets', mode: 'act' }];
    const apps = [{ id: 'a', name: 'Jira & Confluence', url: 'x', auth: 'oauth', enabled: true, status: 'connected', tools: [{ name: 'search', title: 'search', description: '', inputSchema: {}, readOnly: true }] }];
    assert.deepEqual(expand('/daily-standup for today', tasks, apps).text, 'List my open tickets\n\nfor today');
    assert.equal(expand('/daily-standup', tasks, apps).mode, 'act');
    assert.equal(expand('/unknown hi', tasks, apps).text, '/unknown hi');
    const at = expand('@jira-confluence open bugs', tasks, apps);
    assert.equal(at.text, 'open bugs');
    assert.match(at.hint, /jira_confluence__/);
    assert.equal(expand('@jira-confluence x', tasks, [{ ...apps[0], enabled: false }]).hint, undefined);
    assert.deepEqual(suggestions('/da', tasks, apps).map((s) => s.label), ['/daily-standup']);
    assert.deepEqual(suggestions('/daily x', tasks, apps), []);
  });
  check('saved keys are masked to a recognisable prefix and last four', () => {
    const { maskKey } = require('../src/lib/settings.ts');
    assert.equal(maskKey('nvapi-abcdefghijklmnop1234'), 'nvapi-••••••1234');
    assert.equal(maskKey('sk-or-v1-abcdefghijklmnop9876'), 'sk-or-v1-••••••9876');
    assert.equal(maskKey('sk-ant-api03-abcdefghij5555'), 'sk-ant-api03-••••••5555');
    assert.equal(maskKey('short'), '••••••'); // too short to show any of it safely
    assert.equal(maskKey(''), '');
  });
  check('no source file carries text saved in the wrong encoding', () => {
    // UTF-8 read as Windows-1252 turns ▍ into "â–" and é into "Ã©"; the panel once showed that.
    const path = require('node:path');
    const garbled = /â[\u0080-¿–—€‚-„‘-”†-•…™]|Ã[\u0080-¿]/;
    const found = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|css|html)$/.test(name) && garbled.test(fs.readFileSync(p, 'utf8'))) found.push(p);
      }
    };
    walk(path.join(__dirname, '..', 'src'));
    assert.deepEqual(found, []);
  });
  console.log(`${checks}/${checks} checks passed`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
