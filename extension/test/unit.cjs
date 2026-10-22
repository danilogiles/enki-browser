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

check('legacy card shows only for address bar searches, not from=home', () => {
  const { showLegacyCard } = require('../src/lib/legacy-search.ts');
  assert.equal(showLegacyCard('?q=weather'), true);
  assert.equal(showLegacyCard('?q=weather&from=home'), false);
  assert.equal(showLegacyCard('?from=home&q=weather'), false);
  assert.equal(showLegacyCard('?view=settings'), false);
  assert.equal(showLegacyCard('?q=%20'), false);
});

check('legacy ?q= in Incognito goes straight to DuckDuckGo, before render or storage', () => {
  const { incognitoRedirect } = require('../src/lib/legacy-search.ts');
  assert.equal(incognitoRedirect('?q=weather%20toronto', true), 'https://duckduckgo.com/?q=weather%20toronto');
  assert.equal(incognitoRedirect('?q=a%26b&x=1', true), 'https://duckduckgo.com/?q=a%26b');
  assert.equal(incognitoRedirect('?q=weather', false), null);
  assert.equal(incognitoRedirect('?q=%20', true), null);
  const main = fs.readFileSync(require('node:path').join(__dirname, '../src/sidepanel/main.tsx'), 'utf8');
  const guard = main.indexOf('incognitoRedirect(location.search, chrome.extension.inIncognitoContext)');
  assert.ok(guard > 0 && guard < main.indexOf('createRoot(document'), 'redirect runs before the app renders');
  assert.match(main, /if \(away\) location\.replace\(away\);\s*else createRoot/);
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
  {
    // Act never reaches a browser-internal page: not Enki Shields' settings (Burn all data), not its
    // panel, not chrome://. Every tool that acts on the page is refused before the content script,
    // scripting or the debugger is touched, so nothing on the page can be clicked or pressed.
    const { BrowserExecutor, isRestrictedUrl } = require('../src/lib/tools/executor.ts');
    const realChrome = global.chrome;
    const touched = [];
    const internal = [
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html',
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html?tab=3',
      'chrome://settings/clearBrowserData',
      undefined, // a tab whose address the panel cannot see counts as internal too
    ];
    for (const url of internal) {
      touched.length = 0;
      global.chrome = {
        runtime: { getManifest: () => ({ content_scripts: [{ js: ['content.js'] }] }) },
        tabs: {
          get: async (id) => ({ id, url, windowId: 1, active: true, title: 'Enki Shields settings' }),
          query: async () => [{ id: 7, url, windowId: 1, active: true }],
          sendMessage: async (...a) => { touched.push(['tabs.sendMessage', a[1]?.type]); return { ok: true, data: { x: 10, y: 10, tag: 'button', role: 'button', name: 'Burn', sensitive: false } }; },
          update: async (...a) => { touched.push(['tabs.update', a[1]]); return {}; },
          create: async (...a) => { touched.push(['tabs.create', a[0]]); return { id: 8 }; },
        },
        scripting: { executeScript: async () => { touched.push(['scripting.executeScript']); } },
        debugger: {
          onDetach: { addListener() {} },
          attach: async () => { touched.push(['debugger.attach']); },
          sendCommand: async (...a) => { touched.push(['debugger.sendCommand', a[1], a[2]?.type]); },
          detach: async () => {},
        },
      };
      const ex = new BrowserExecutor(1);
      const tries = [
        { name: 'click', input: { x: 120, y: 80 } },
        { name: 'click', input: { ref: 'ref_1' } },
        { name: 'press_key', input: { key: 'Enter' } },
        { name: 'press_key', input: { key: 'Tab' } },
        { name: 'type', input: { text: 'x', submit: true } },
        { name: 'scroll', input: { direction: 'down' } },
        { name: 'read_page', input: {} },
        { name: 'navigate', input: { url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html' } },
        { name: 'navigate', input: { url: 'chrome://settings/' } },
        { name: 'new_tab', input: { url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html' } },
      ];
      for (const t of tries) {
        let refused = null;
        try {
          const plan = await ex.prepare({ type: 'tool_call', id: 'c', name: t.name, input: t.input });
          await plan.run();
        } catch (e) { refused = e instanceof Error ? e.message : String(e); }
        assert.ok(refused && /browser-internal page|Security restriction/.test(refused), `${t.name} ${JSON.stringify(t.input)} on ${url} was not refused: ${refused}`);
      }
      assert.deepEqual(touched, [], `Act touched ${url}: ${JSON.stringify(touched)}`);
    }
    assert.ok(isRestrictedUrl('chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html'));
    global.chrome = realChrome;
    checks++; console.log('PASS', "Act cannot click, type, press keys on or navigate to Shields' settings, its panel or chrome:// pages");
  }
  {
    // Empty new_tab opens the browser new-tab page, never a search engine.
    const { BrowserExecutor } = require('../src/lib/tools/executor.ts');
    const realChrome = global.chrome;
    let created;
    global.chrome = {
      runtime: { getManifest: () => ({ content_scripts: [] }) },
      tabs: {
        get: async (id) => created && created.id === id ? created : { id: 1, url: 'https://start.test/', windowId: 1, active: true, title: 'Start' },
        query: async () => [{ id: 1, url: 'https://start.test/', windowId: 1, active: true, title: 'Start' }],
        create: async (opts) => { created = { id: 9, url: opts.url, windowId: opts.windowId, active: true, title: 'New Tab' }; return created; },
        sendMessage: async () => ({ ok: true, data: true }),
      },
      scripting: { executeScript: async () => {} },
      debugger: { onDetach: { addListener() {} }, attach: async () => {}, sendCommand: async () => {}, detach: async () => {} },
    };
    const ex = new BrowserExecutor(1);
    const plan = await ex.prepare({ type: 'tool_call', id: 'c', name: 'new_tab', input: {} });
    const out = await plan.run();
    assert.equal(created.url, 'chrome://newtab/');
    assert.match(out.content[0].text, /new tab/);
    global.chrome = realChrome;
    checks++; console.log('PASS', 'new_tab with no URL opens chrome://newtab/, not a search engine');
  }

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
  {
    // Ctrl+Shift+E: chrome.sidePanel.open is only allowed inside the user gesture that fired the
    // command. The fake rejects any call made after the listener's first synchronous run, the way
    // Chromium does, so an await before sidePanel.open (the 0.8.3 bug) falls back to a popup here.
    const path = require('node:path');
    let gesture = false;
    const calls = [];
    let commandListener;
    const realChrome = global.chrome;
    global.chrome = {
      runtime: {
        getManifest: () => ({}), getURL: (p) => 'chrome-extension://enki/' + p,
        onInstalled: { addListener() {} }, onStartup: { addListener() {} },
        sendMessage: async (m) => { calls.push(['sendMessage', m.command, m.windowId]); },
      },
      sidePanel: {
        setPanelBehavior: async () => {},
        open: async ({ windowId }) => {
          calls.push(['sidePanel.open', windowId, gesture]);
          if (!gesture) throw new Error('`sidePanel.open()` may only be called in response to a user gesture.');
        },
      },
      action: { onClicked: { addListener() {} } },
      commands: { onCommand: { addListener: (fn) => { commandListener = fn; } } },
      windows: {
        getLastFocused: async () => { calls.push(['getLastFocused']); return { id: 99 }; },
        create: async () => { calls.push(['windows.create']); return {}; },
        update: async () => {},
      },
      tabs: { query: async () => [] },
    };
    const swPath = path.join(__dirname, '..', 'src', 'background', 'service-worker.ts');
    delete require.cache[swPath];
    require(swPath);
    const press = async (command, tab) => {
      calls.length = 0;
      gesture = true;
      const done = commandListener(command, tab);
      gesture = false; // the gesture ends when the listener yields for the first time
      await done;
      return calls.map((c) => c.join(' '));
    };
    let log = await press('open-panel', { id: 3, windowId: 7 });
    check('Ctrl+Shift+E opens the side panel inside the shortcut gesture', () => {
      assert.deepEqual(log[0], 'sidePanel.open 7 true');
      assert.ok(!log.includes('windows.create'), 'no popup fallback: ' + log.join(', '));
    });
    log = await press('focus-composer', { id: 3, windowId: 7 });
    check('focus-composer opens the panel inside the gesture, then reaches the composer', () => {
      assert.deepEqual(log[0], 'sidePanel.open 7 true');
      assert.ok(log.includes('sendMessage focus-composer 7'), log.join(', '));
      assert.ok(!log.includes('windows.create'));
    });
    log = await press('stop-task', { id: 3, windowId: 7 });
    check('stop-task does not open the panel', () => {
      assert.deepEqual(log, ['sendMessage stop-task 7']);
    });
    const warn = console.warn;
    console.warn = () => {}; // the gesture is gone after getLastFocused, so this case warns and falls back
    log = await press('open-panel', undefined);
    console.warn = warn;
    check('a command without a tab still targets the last focused window', () => {
      assert.ok(log.includes('getLastFocused'));
      assert.ok(log.some((l) => l.startsWith('sidePanel.open 99')), log.join(', '));
    });
    global.chrome = realChrome;
  }
  {
    // The per-message screenshot is off by default (0.3.6), and turned off once for settings saved
    // before, when every key, the old default (on) included, was written with the first save.
    const S = require('../src/lib/settings.ts');
    const saved = global.chrome;
    let store = {};
    let writes = 0;
    global.chrome = { ...saved, storage: { local: {
      get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
      set: async (o) => { writes++; Object.assign(store, structuredClone(o)); },
    }, onChanged: { addListener() {}, removeListener() {} } } };
    check('the per-message screenshot is off by default', () => {
      assert.equal(S.DEFAULT_SETTINGS.attachScreenshot, false);
      assert.equal(S.migrateSettings(undefined).settings.attachScreenshot, false);
      assert.equal(S.migrateSettings(undefined).migrated, false, 'a fresh profile has nothing to migrate');
    });
    let s = await S.loadSettings();
    check('a fresh profile loads with the screenshot off and writes nothing', () => {
      assert.equal(s.attachScreenshot, false);
      assert.equal(writes, 0);
    });
    // Settings saved by Enki 0.3.5 or earlier: no settingsVersion, screenshot on.
    store = { 'enki:settings': { preset: 'custom', baseUrl: 'http://127.0.0.1:9/v1', model: 'm', vision: true, attachScreenshot: true, theme: 'dark' } };
    writes = 0;
    s = await S.loadSettings();
    check('the first load after the upgrade turns the screenshot off and records the migration', () => {
      assert.equal(s.attachScreenshot, false);
      assert.equal(writes, 1);
      assert.equal(store['enki:settings'].attachScreenshot, false);
      assert.equal(store['enki:settings'].settingsVersion, S.SETTINGS_VERSION);
      assert.equal(store['enki:settings'].vision, true, 'other settings are kept');
      assert.equal(store['enki:settings'].model, 'm');
    });
    writes = 0;
    await S.loadSettings(); await S.loadSettings();
    check('the migration runs once: later loads write nothing', () => assert.equal(writes, 0));
    await S.saveSettings({ ...s, attachScreenshot: true });
    writes = 0;
    s = await S.loadSettings();
    const again = await S.loadSettings();
    check('turning the screenshot back on survives every later load', () => {
      assert.equal(s.attachScreenshot, true);
      assert.equal(again.attachScreenshot, true);
      assert.equal(store['enki:settings'].attachScreenshot, true);
      assert.equal(writes, 0);
    });
    check('settings from a newer version are not migrated back', () => {
      const r = S.migrateSettings({ attachScreenshot: true, settingsVersion: S.SETTINGS_VERSION + 1 });
      assert.equal(r.settings.attachScreenshot, true);
      assert.equal(r.migrated, false);
      assert.equal(r.settings.settingsVersion, S.SETTINGS_VERSION + 1);
    });
    // Stored values that are not what Enki wrote: a junk version counts as 0 (migrate once, store
    // 1), anything but a plain object counts as nothing stored, and unknown keys are dropped.
    const M = S.migrateSettings;
    check('a string settingsVersion counts as 0: migrated once, then the current version', () => {
      const r = M({ attachScreenshot: true, settingsVersion: '1' });
      assert.equal(r.migrated, true); assert.equal(r.settings.attachScreenshot, false); assert.equal(r.settings.settingsVersion, S.SETTINGS_VERSION);
    });
    check('a NaN or Infinity settingsVersion counts as 0', () => {
      for (const v of [NaN, Infinity, -Infinity, null, {}]) {
        const r = M({ attachScreenshot: true, settingsVersion: v });
        assert.equal(r.migrated, true, String(v)); assert.equal(r.settings.attachScreenshot, false); assert.equal(r.settings.settingsVersion, S.SETTINGS_VERSION);
        assert.ok(Number.isFinite(r.settings.settingsVersion));
      }
    });
    check('stored settings that are an array, a string, a number or null give the defaults', () => {
      for (const v of [[{ attachScreenshot: true }], 'attachScreenshot', 42, null, true]) {
        const r = M(v);
        assert.equal(r.migrated, false, JSON.stringify(v));
        assert.deepEqual({ ...r.settings, settingsVersion: undefined }, { ...S.DEFAULT_SETTINGS, settingsVersion: undefined });
        assert.ok(!('0' in r.settings) && !('length' in r.settings));
      }
    });
    check('only known keys are merged from storage', () => {
      const r = M({ model: 'm', junk: 1, __proto__x: 2, constructor: 'x', apiKeys: 'not-an-object', settingsVersion: 1 });
      assert.equal(r.settings.model, 'm');
      assert.ok(!('junk' in r.settings) && !('__proto__x' in r.settings) && !Object.hasOwn(r.settings, 'constructor'));
      assert.ok(!Object.hasOwn(r.settings, 'apiKeys'), 'apiKeys that is not an object is dropped');
    });
    store = { 'enki:settings': 'garbage' };
    writes = 0;
    s = await S.loadSettings();
    check('a stored string loads as the defaults without throwing', () => { assert.equal(s.attachScreenshot, false); assert.equal(s.model, S.DEFAULT_SETTINGS.model); assert.equal(writes, 0); });
    store = { 'enki:settings': { model: 'm', vision: true, attachScreenshot: true, settingsVersion: 'oops', junk: 'x' } };
    writes = 0;
    s = await S.loadSettings();
    check('a junk version is repaired: screenshot off, version 1 stored, junk keys gone', () => {
      assert.equal(s.attachScreenshot, false); assert.equal(writes, 1);
      assert.equal(store['enki:settings'].settingsVersion, S.SETTINGS_VERSION); assert.ok(!('junk' in store['enki:settings']));
    });
    await S.saveSettings({ ...s, attachScreenshot: true });
    writes = 0;
    s = await S.loadSettings(); await S.loadSettings();
    check('after a junk version is repaired, a later opt-in survives every load', () => {
      assert.equal(s.attachScreenshot, true); assert.equal(store['enki:settings'].attachScreenshot, true); assert.equal(writes, 0);
    });
    global.chrome = saved;
  }
  {
    // Enki Home -> panel handoff is addressed to one window (wrong-window Act fix). Every panel in
    // every window hears the storage change; only the one controlling that window may take it.
    const saved = global.chrome;
    const store = {};
    global.chrome = { ...saved, storage: { session: {
      get: async (k) => (k in store ? { [k]: store[k] } : {}),
      set: async (o) => { Object.assign(store, o); },
      remove: async (k) => { delete store[k]; },
    } } };
    const { putHandoff, takeHandoff } = require('../src/lib/handoff.ts');
    const NORMAL = 11, OTHER = 12, INCOGNITO = 99;
    await putHandoff('find computers', 'act', NORMAL);
    assert.equal(await takeHandoff(OTHER), null);
    assert.equal(await takeHandoff(undefined), null);
    assert.ok(store['enki:handoff'], 'a request for another window is left for its own panel');
    const got = await takeHandoff(NORMAL);
    assert.equal(got && got.text, 'find computers');
    assert.equal(await takeHandoff(NORMAL), null);
    checks++; console.log('PASS [HANDOFF-WINDOW] an Act request from Home is taken only by its own window\'s panel, once');
    store['enki:handoff'] = { text: 'no window', mode: 'act', at: Date.now() };
    for (const w of [NORMAL, OTHER, INCOGNITO, undefined]) assert.equal(await takeHandoff(w), null);
    checks++; console.log('PASS [HANDOFF-NO-WINDOW] an Act request without a window is taken by no panel');
    await putHandoff('incognito task', 'act', INCOGNITO);
    assert.equal(await takeHandoff(NORMAL), null);
    assert.equal((await takeHandoff(INCOGNITO)).text, 'incognito task');
    await putHandoff('normal task', 'act', NORMAL);
    assert.equal(await takeHandoff(INCOGNITO), null);
    checks++; console.log('PASS [HANDOFF-INCOGNITO] requests never cross between an Incognito window and a normal one');
    global.chrome = saved;
  }
  {
    // 0.8.12: plain HTTP to a model address on the local network (providers/endpoint-policy.ts).
    const P = require('../src/lib/providers/endpoint-policy.ts');
    const S = require('../src/lib/settings.ts');
    const { OpenAICompatProvider } = require('../src/lib/providers/openai-compat.ts');
    const { AnthropicProvider } = require('../src/lib/providers/anthropic.ts');
    const { createProvider } = require('../src/lib/providers/index.ts');
    const realFetch = global.fetch;
    let sent = [];
    global.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const h = new Headers(init.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined));
      sent.push({ url, auth: h.get('authorization'), xkey: h.get('x-api-key') });
      return new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const LAN = 'http://192.168.1.20:11434';
    const oa = (baseUrl, apiKey = '', localHttpOrigins) => new OpenAICompatProvider({ apiKey, baseUrl, localHttpOrigins });
    const reaches = async (provider) => { sent = []; try { await provider.listModels(); } catch (e) { if (!(e instanceof P.EndpointBlockedError)) throw e; return { blocked: e, sent }; } return { blocked: null, sent }; };
    const streams = async (provider) => {
      sent = [];
      try { for await (const _ of provider.stream({ system: 's', messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }], tools: [], model: 'm' })) break; }
      catch (e) { if (e instanceof P.EndpointBlockedError) return { blocked: e, sent }; }
      return { blocked: null, sent };
    };
    const anthropic = async (baseUrl, apiKey, localHttpOrigins) => {
      sent = [];
      try { await new AnthropicProvider({ apiKey, baseUrl, localHttpOrigins }).listModels(); }
      catch (e) { if (e instanceof P.EndpointBlockedError || e?.cause instanceof P.EndpointBlockedError) return { blocked: true, sent }; return { blocked: false, sent, error: e }; }
      return { blocked: false, sent };
    };

    // (a) A public IP over HTTP is refused, even if someone wrote it into the exception list.
    for (const url of ['http://8.8.8.8/v1', 'http://203.0.113.7:8080/v1', 'http://[2001:4860:4860::8888]/v1', 'http://169.254.1.1/v1', 'http://100.64.0.1/v1']) {
      const v = P.evaluateEndpoint(url, { hasKey: false, exceptions: [P.originOf(url)] });
      assert.equal(v.state, 'public', url); assert.equal(v.allowed, false, url);
      const r = await reaches(oa(url, '', [P.originOf(url)]));
      assert.ok(r.blocked, url); assert.equal(r.sent.length, 0, url);
      assert.match(r.blocked.message, /Public addresses need HTTPS/);
    }
    assert.deepEqual(P.sanitizeExceptions(['http://8.8.8.8:80', 'http://ollama.local:11434', 'https://192.168.1.20:443', 'junk', 7, LAN]), [LAN]);
    checks++; console.log('PASS [LOCAL-HTTP-PUBLIC] a public IP over HTTP is refused before any request, exception or not');

    // (b) A hostname over HTTP is refused: DNS can point it anywhere (rebinding), ollama.local included.
    for (const url of ['http://ollama.local:11434/v1', 'http://my-box/v1', 'http://example.com/v1', 'http://localhost.example.com/v1', 'http://foo.localhost/v1']) {
      const v = P.evaluateEndpoint(url, { hasKey: false, exceptions: [P.originOf(url)] });
      assert.equal(v.state, 'hostname', url); assert.equal(v.allowed, false, url);
      const r = await reaches(oa(url, '', [P.originOf(url)]));
      assert.ok(r.blocked, url); assert.equal(r.sent.length, 0, url);
      const st = await streams(oa(url, '', [P.originOf(url)]));
      assert.ok(st.blocked, url); assert.equal(st.sent.length, 0, url);
    }
    assert.equal(P.evaluateEndpoint('https://ollama.local/v1', { hasKey: true }).allowed, true, 'over HTTPS a hostname is fine');
    checks++; console.log('PASS [LOCAL-HTTP-HOSTNAME] a hostname over HTTP (ollama.local too) is refused before any request');

    // (c) A key is never sent over HTTP to a private IP, even with the exception on.
    {
      const v = P.evaluateEndpoint(LAN + '/v1', { hasKey: true, exceptions: [LAN] });
      assert.equal(v.state, 'key-over-http'); assert.equal(v.allowed, false);
      for (const r of [await reaches(oa(LAN + '/v1', 'sk-secret', [LAN])), await streams(oa(LAN + '/v1', 'sk-secret', [LAN]))]) {
        assert.ok(r.blocked); assert.equal(r.sent.length, 0, 'nothing leaves, so the key cannot');
      }
      const a = await anthropic(LAN, 'sk-ant-secret', [LAN]);
      assert.equal(a.blocked, true, String(a.error)); assert.equal(a.sent.length, 0);
      const { guardedFetch } = require('../src/lib/providers/endpoint-guard.ts');
      sent = [];
      assert.throws(() => guardedFetch('sk-ant-secret', [LAN])(LAN + '/v1/messages', { method: 'POST' }), P.EndpointBlockedError);
      assert.throws(() => guardedFetch('sk-ant-secret', [LAN])(new URL(LAN + '/v1/models')), P.EndpointBlockedError);
      assert.equal(sent.length, 0, 'the fetch the SDK is given refuses too');
    }
    checks++; console.log('PASS [LOCAL-HTTP-KEY] an API key is never sent over HTTP to a private IP, exception or not (OpenAI-compatible and Anthropic)');

    // (d) Loopback over HTTP still gets the key (OmniRoute, Ollama, anything on this computer).
    for (const base of ['http://localhost:20128/v1', 'http://localhost:11434/v1', 'http://127.0.0.1:9/v1', 'http://127.8.9.10:1234/v1', 'http://[::1]:8080/v1']) {
      assert.equal(P.evaluateEndpoint(base, { hasKey: true }).state, 'loopback', base);
      const r = await reaches(oa(base, 'sk-local'));
      assert.equal(r.blocked, null, base); assert.equal(r.sent.length, 1); assert.equal(r.sent[0].auth, 'Bearer sk-local', base);
    }
    {
      const a = await anthropic('http://127.0.0.1:9', 'sk-ant-local');
      assert.equal(a.blocked, false); assert.equal(a.sent.length >= 1, true); assert.equal(a.sent[0].xkey, 'sk-ant-local');
    }
    checks++; console.log('PASS [LOCAL-HTTP-LOOPBACK] loopback over HTTP is allowed and the key is still sent');

    // (e) A private IP is refused without the exception and reached with it, for that exact origin only.
    {
      assert.equal(P.evaluateEndpoint(LAN + '/v1', { hasKey: false }).state, 'private-off');
      let r = await reaches(oa(LAN + '/v1'));
      assert.ok(r.blocked); assert.equal(r.sent.length, 0);
      r = await reaches(oa(LAN + '/v1', '', [LAN]));
      assert.equal(r.blocked, null); assert.equal(r.sent.length, 1); assert.equal(r.sent[0].auth, null, 'no key, no Authorization header');
      for (const other of ['http://192.168.1.20:11435/v1', 'http://192.168.1.21:11434/v1', 'http://192.168.1.20/v1', 'http://10.0.0.5:11434/v1']) {
        assert.equal(P.evaluateEndpoint(other, { hasKey: false, exceptions: [LAN] }).allowed, false, other);
        const o = await reaches(oa(other, '', [LAN]));
        assert.ok(o.blocked, other); assert.equal(o.sent.length, 0, other);
      }
      for (const lan of ['http://10.1.2.3:8000', 'http://172.16.0.9:8000', 'http://172.31.255.1:80', 'http://[fd12:3456::1]:8000']) {
        assert.equal(P.evaluateEndpoint(lan + '/v1', { hasKey: false }).state, 'private-off', lan);
        assert.equal(P.evaluateEndpoint(lan + '/v1', { hasKey: false, exceptions: [lan] }).state, 'private-on', lan);
      }
      assert.equal(P.evaluateEndpoint('http://172.32.0.1/v1', { hasKey: false }).state, 'public', '172.32/16 is not private');
      assert.equal(P.originOf('http://192.168.1.20/v1'), 'http://192.168.1.20:80', 'the default port is written out');
      assert.deepEqual(P.addException([], 'http://192.168.1.20:11434/v1/'), [LAN]);
    }
    checks++; console.log('PASS [LOCAL-HTTP-EXACT-ORIGIN] a private IP over HTTP is refused unless that exact origin is allowed; another port is refused');

    // (f) Revoke deletes the saved exception at once (not on the next Save).
    {
      const saved = global.chrome;
      const store = { 'enki:settings': { preset: 'custom', baseUrl: LAN + '/v1', model: 'm', settingsVersion: S.SETTINGS_VERSION,
        localHttpOrigins: [LAN, 'http://10.0.0.5:8000'] } };
      global.chrome = { ...saved, storage: { local: {
        get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
        set: async (o) => { Object.assign(store, structuredClone(o)); },
        remove: async (k) => { delete store[k]; },
      }, onChanged: { addListener() {}, removeListener() {} } } };
      let s = await S.loadSettings();
      assert.equal(P.evaluateEndpoint(s.baseUrl, { hasKey: false, exceptions: s.localHttpOrigins }).state, 'private-on');
      await S.revokeLocalHttp(LAN);
      assert.deepEqual(store['enki:settings'].localHttpOrigins, ['http://10.0.0.5:8000'], 'only that origin is deleted');
      s = await S.loadSettings();
      assert.equal(P.evaluateEndpoint(s.baseUrl, { hasKey: false, exceptions: s.localHttpOrigins }).state, 'private-off');
      const r = await reaches(createProvider(s));
      assert.ok(r.blocked); assert.equal(r.sent.length, 0);
      global.chrome = saved;
    }
    checks++; console.log('PASS [LOCAL-HTTP-REVOKE] Revoke deletes the saved exception and the address is refused again');

    // (g) The 0.8.12 migration: carry over only a literal private IP with no saved key.
    {
      const old = (baseUrl, extra = {}) => ({ preset: 'custom', baseUrl, model: 'm', settingsVersion: 1, ...extra });
      let r = S.migrateSettings(old(LAN + '/v1'));
      assert.equal(r.migrated, true); assert.deepEqual(r.settings.localHttpOrigins, [LAN]);
      assert.deepEqual(r.endpointNotice, { kind: 'carried', origin: LAN });
      let probe = await reaches(createProvider(r.settings));
      assert.equal(probe.blocked, null, 'the carried address keeps working'); assert.equal(probe.sent.length, 1);

      r = S.migrateSettings(old(LAN + '/v1', { apiKeys: { custom: 'enc:v1:stored' } }));
      assert.ok(!r.settings.localHttpOrigins?.length, 'a private IP with a saved key is not carried over');
      assert.deepEqual(r.endpointNotice, { kind: 'blocked-key', origin: LAN });
      assert.equal(r.settings.apiKeys.custom, 'enc:v1:stored', 'the key stays stored');
      probe = await reaches(createProvider({ ...r.settings, apiKey: 'sk-secret' }));
      assert.ok(probe.blocked); assert.equal(probe.sent.length, 0, 'and is never sent');
      r = S.migrateSettings(old(LAN + '/v1', { apiKey: 'sk-legacy-plain' }));
      assert.equal(r.endpointNotice.kind, 'blocked-key', 'a pre-per-provider key counts too');

      for (const [url, kind] of [['http://ollama.local:11434/v1', 'blocked-host'], ['http://8.8.8.8/v1', 'blocked-public']]) {
        r = S.migrateSettings(old(url));
        assert.ok(!r.settings.localHttpOrigins?.length, url);
        assert.deepEqual(r.endpointNotice, { kind, origin: P.originOf(url) }, url);
        probe = await reaches(createProvider(r.settings));
        assert.ok(probe.blocked, url); assert.equal(probe.sent.length, 0, url);
      }
      for (const url of ['http://localhost:11434/v1', 'https://192.168.1.20/v1', 'https://api.openai.com/v1']) {
        r = S.migrateSettings(old(url, { apiKeys: { custom: 'enc:v1:k' } }));
        assert.equal(r.endpointNotice, null, url);
      }
      r = S.migrateSettings(old(LAN + '/v1', { settingsVersion: S.SETTINGS_VERSION }));
      assert.equal(r.endpointNotice, null, 'it runs once'); assert.equal(r.migrated, false);
      assert.equal(S.migrateSettings(undefined).endpointNotice, null, 'a fresh profile has nothing to carry');
      assert.equal(P.CARRY_OVER_PRIVATE_HTTP, true);
      const off = P.migrateEndpoint(LAN + '/v1', false, undefined, false);
      assert.deepEqual(off, { exceptions: [], notice: { kind: 'private-off', origin: LAN } }, 'with the constant off: blocked, and the notice says how to turn it on');

      // The notice is UI-only: stored apart from Settings, shown once, gone after Dismiss.
      const saved = global.chrome;
      const store = { 'enki:settings': old(LAN + '/v1') };
      global.chrome = { ...saved, storage: { local: {
        get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
        set: async (o) => { Object.assign(store, structuredClone(o)); },
        remove: async (k) => { delete store[k]; },
      }, onChanged: { addListener() {}, removeListener() {} } } };
      const s = await S.loadSettings();
      assert.deepEqual(s.localHttpOrigins, [LAN]); assert.deepEqual(store['enki:settings'].localHttpOrigins, [LAN]);
      assert.ok(!JSON.stringify(store['enki:settings']).includes('carried'), 'the notice is not a setting');
      assert.deepEqual(await S.takeEndpointNotice(), { kind: 'carried', origin: LAN });
      await S.loadSettings();
      assert.deepEqual(await S.takeEndpointNotice(), { kind: 'carried', origin: LAN }, 'a reload does not make a second one');
      await S.dismissEndpointNotice();
      assert.equal(await S.takeEndpointNotice(), null);
      await S.loadSettings();
      assert.equal(await S.takeEndpointNotice(), null, 'shown once');
      global.chrome = saved;
    }
    checks++; console.log('PASS [LOCAL-HTTP-MIGRATION] 0.8.12 carries over only a private IP with no key; a key or a hostname/public IP is blocked with a notice');

    // (h) An allowed endpoint must not be able to redirect the request (and its body and key) past the
    // policy. A loopback endpoint answers 307 and 308 to http://203.0.113.5/ (a public IP over HTTP,
    // always refused). Connections to 203.0.113.5 are intercepted at net.connect and sent to a local trap
    // listener instead, so the test sees whether anything would have reached the target.
    {
      const http = require('node:http');
      const net = require('node:net');
      const listen = (handler) => new Promise((resolve) => { const srv = http.createServer(handler); srv.listen(0, '127.0.0.1', () => resolve(srv)); });
      const trapHits = [];
      const trap = await listen((rq, rs) => {
        let body = ''; rq.on('data', (c) => { body += c; });
        rq.on('end', () => { trapHits.push({ method: rq.method, url: rq.url, body, auth: rq.headers.authorization, xkey: rq.headers['x-api-key'] }); rs.writeHead(200, { 'content-type': 'application/json' }); rs.end('{"data":[{"id":"stolen"}]}'); });
      });
      const targetConnects = [];
      const realConnect = net.connect;
      net.connect = function (...args) {
        const o = args[0] && typeof args[0] === 'object' ? args[0] : { host: args[1], port: args[0] };
        if (o.host === '203.0.113.5') { targetConnects.push(`${o.host}:${o.port}`); return realConnect.call(net, { ...o, host: '127.0.0.1', port: trap.address().port }); }
        return realConnect.apply(net, args);
      };
      let status = 307; const originHits = [];
      const origin = await listen((rq, rs) => { originHits.push(`${rq.method} ${rq.url}`); rq.resume(); rs.writeHead(status, { location: `http://203.0.113.5${rq.url}` }); rs.end(); });
      const base = `http://127.0.0.1:${origin.address().port}/v1`;
      global.fetch = realFetch;
      const fails = async (run) => { try { await run(); return false; } catch { return true; } };
      try {
        for (const code of [307, 308]) {
          status = code;
          const oaFailed = await fails(() => oa(base, 'sk-local').listModels());
          const oaStreamFailed = await fails(async () => {
            for await (const _ of oa(base, 'sk-local').stream({ system: 's', messages: [{ role: 'user', parts: [{ type: 'text', text: 'secret question' }] }], tools: [], model: 'm' })) {}
          });
          const anFailed = await fails(async () => {
            const a = new AnthropicProvider({ apiKey: 'sk-ant-local', baseUrl: `http://127.0.0.1:${origin.address().port}`, localHttpOrigins: [] });
            a.client.maxRetries = 0;
            await a.listModels();
          });
          assert.ok(oaFailed, `${code}: OpenAI-compatible model listing must fail on a redirect`);
          assert.ok(oaStreamFailed, `${code}: OpenAI-compatible chat POST must fail on a redirect`);
          assert.ok(anFailed, `${code}: Anthropic must fail on a redirect`);
        }
        assert.ok(originHits.length >= 6, `the allowed endpoint was asked: ${originHits}`);
        assert.deepEqual(targetConnects, [], 'nothing connected to 203.0.113.5');
        assert.deepEqual(trapHits, [], 'the redirect target received nothing');
      } finally {
        net.connect = realConnect; origin.close(); trap.close(); global.fetch = realFetch;
      }
    }
    checks++; console.log('PASS [LOCAL-HTTP-REDIRECT] an allowed endpoint answering 307 or 308 to http://203.0.113.5/ fails the request and nothing reaches the target (OpenAI-compatible list and chat, Anthropic)');
    global.fetch = realFetch;
  }
  console.log(`${checks}/${checks} checks passed`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
