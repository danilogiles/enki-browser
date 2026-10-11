// AI search from the address bar (0.8.9): routing, DuckDuckGo URL, request payload, safe Markdown,
// and the Shield → Enki message handler. Same loader as unit.cjs.
const ts = require('typescript');
const fs = require('node:fs');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText, filename);
const S = require('../src/lib/search.ts');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Markdown = require('react-markdown').default;
const { safeMarkdownProps } = require('../src/lib/safe-markdown.ts');

let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log('PASS', name); }
const md = (src) => renderToStaticMarkup(React.createElement(Markdown, safeMarkdownProps, src));

(async () => {
  await check('@enki / @ddg prefixes choose the engine and are stripped', () => {
    assert.deepEqual(S.parseQuery('@enki what is ANC'), { query: 'what is ANC', force: 'enki' });
    assert.deepEqual(S.parseQuery('  @DDG  weather toronto '), { query: 'weather toronto', force: 'ddg' });
    assert.deepEqual(S.parseQuery('email @enki team'), { query: 'email @enki team' });
    assert.deepEqual(S.parseQuery('@enkix foo'), { query: '@enkix foo' });
    assert.deepEqual(S.parseQuery('@ddg'), { query: '', force: 'ddg' });
  });
  await check('route: unset and ddg go to DuckDuckGo; enki only with a model and outside incognito', () => {
    const base = { incognito: false, hasModel: true, query: 'q' };
    assert.equal(S.decideRoute({ ...base, engine: undefined }), 'ddg');
    assert.equal(S.decideRoute({ ...base, engine: 'ddg' }), 'ddg');
    assert.equal(S.decideRoute({ ...base, engine: 'enki' }), 'enki');
    assert.equal(S.decideRoute({ ...base, engine: 'enki', incognito: true }), 'ddg');
    assert.equal(S.decideRoute({ ...base, engine: 'enki', hasModel: false }), 'ddg');
    assert.equal(S.decideRoute({ ...base, engine: 'ddg', force: 'enki' }), 'enki');
    assert.equal(S.decideRoute({ ...base, engine: 'enki', force: 'ddg' }), 'ddg');
    assert.equal(S.decideRoute({ ...base, engine: undefined, force: 'enki', incognito: true }), 'ddg');
    assert.equal(S.decideRoute({ ...base, engine: 'enki', query: '' }), 'ddg');
  });
  await check('DuckDuckGo URL carries only q', () => {
    const u = new URL(S.ddgUrl('a&b=c #x?'));
    assert.equal(u.origin + u.pathname, 'https://duckduckgo.com/');
    assert.deepEqual([...u.searchParams.keys()], ['q']);
    assert.equal(u.searchParams.get('q'), 'a&b=c #x?');
  });
  await check('request: Ask only, the query alone, no tools, no tab/page/history', () => {
    const req = S.buildSearchRequest('m', 'best headphones', 4096);
    assert.deepEqual(req.tools, []);
    assert.equal(req.messages.length, 1);
    assert.deepEqual(req.messages[0], { role: 'user', parts: [{ type: 'text', text: 'best headphones' }] });
    const json = JSON.stringify(req);
    for (const bad of ['tab', 'url', 'page', 'screenshot', 'image', 'history']) assert.ok(!new RegExp(`"${bad}"`, 'i').test(json), bad);
  });
  await check('markdown: raw HTML is dropped', () => {
    const out = md('hi <script>alert(1)</script> <b onclick="x">bold</b> <iframe src="https://e.x"></iframe>');
    assert.ok(!/<script|<iframe|onclick|<b>/i.test(out), out);
  });
  await check('markdown: links get target=_blank rel=noopener noreferrer; unsafe schemes dropped', () => {
    const out = md('[a](https://example.com) [b](javascript:alert(1))');
    assert.match(out, /<a href="https:\/\/example.com\/" target="_blank" rel="noopener noreferrer">a<\/a>/);
    assert.ok(!/javascript:/i.test(out), out);
  });
  await check('markdown: images never load; they become links', () => {
    const out = md('![pixel](https://tracker.example/p.gif)');
    assert.ok(!/<img/i.test(out), out);
    assert.match(out, /rel="noopener noreferrer"/);
    assert.match(out, /Image: pixel/);
  });
  await check('Shield messages: wrong sender rejected, bad values rejected, get/set work', async () => {
    let stored;
    const io = { get: async () => stored, set: async (v) => { stored = v; } };
    const shield = { id: S.SHIELD_EXTENSION_ID };
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:setSearchEngine', value: 'enki' }, { id: 'evil' }, io), { ok: false, error: 'forbidden' });
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:getSearchEngine' }, {}, io), { ok: false, error: 'forbidden' });
    assert.equal(stored, undefined);
    for (const value of ['ENKI', 'google', '', null, ['enki'], { toString: () => 'enki' }])
      assert.deepEqual(await S.handleExternalMessage({ type: 'enki:setSearchEngine', value }, shield, io), { ok: false, error: 'invalid value' });
    assert.deepEqual(await S.handleExternalMessage({ type: 'other' }, shield, io), { ok: false, error: 'unknown message' });
    assert.deepEqual(await S.handleExternalMessage(null, shield, io), { ok: false, error: 'unknown message' });
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:getSearchEngine' }, shield, io), { ok: true, value: null });
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:setSearchEngine', value: 'enki' }, shield, io), { ok: true });
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:getSearchEngine' }, shield, io), { ok: true, value: 'enki' });
  });
  await check('setting helpers use one storage key and notify on change', async () => {
    const store = {}; const listeners = [];
    global.chrome = { storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => { Object.assign(store, o); for (const l of listeners) l(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { newValue: v }])), 'local'); } },
      onChanged: { addListener: (l) => listeners.push(l), removeListener: () => {} } } };
    assert.equal(await S.getSearchEngine(), undefined);
    const seen = []; S.onSearchEngineChange((v) => seen.push(v));
    await S.setSearchEngine('enki');
    assert.equal(await S.getSearchEngine(), 'enki');
    assert.deepEqual(seen, ['enki']);
    await assert.rejects(S.setSearchEngine('bing'));
  });
  console.log(`${checks}/${checks} checks passed`);
})().catch((e) => { console.error(e); process.exitCode = 1; });

// The default path (unset / ddg) must leave immediately, without any network request.
(async () => {
  const S2 = require('../src/lib/search.ts');
  let fetches = 0;
  const realFetch = global.fetch;
  global.fetch = async () => { fetches++; throw new Error('no network expected'); };
  for (const [engine, settings, q, expect] of [
    [undefined, undefined, 'hello world', 'ddg'],
    ['ddg', { preset: 'ollama', model: 'qwen3' }, 'hello', 'ddg'],
    ['enki', { preset: 'openai', model: 'gpt-5' }, 'hello', 'ddg'], // no key → no model
    ['enki', { preset: 'ollama', model: 'qwen3' }, '@ddg hi', 'ddg'],
    ['enki', { preset: 'ollama', model: 'qwen3' }, 'hi', 'enki'],
  ]) {
    const replaced = [];
    const r = await S2.earlyRoute({
      href: 'chrome-extension://x/search.html?q=' + encodeURIComponent(q), incognito: false,
      storageGet: async () => ({ [S2.SEARCH_ENGINE_KEY]: engine, 'enki:settings': settings }),
      replace: (u) => replaced.push(u),
    });
    assert.equal(r.route, expect, `${engine} ${q}`);
    if (expect === 'ddg') { assert.equal(replaced.length, 1); assert.deepEqual([...new URL(replaced[0]).searchParams.keys()], ['q']); }
    else assert.equal(replaced.length, 0);
  }
  const replaced = [];
  await S2.earlyRoute({ href: 'chrome-extension://x/search.html?q=a', incognito: true,
    storageGet: async () => ({ [S2.SEARCH_ENGINE_KEY]: 'enki', 'enki:settings': { preset: 'ollama', model: 'q' } }), replace: (u) => replaced.push(u) });
  assert.equal(replaced.length, 1, 'incognito goes to DuckDuckGo');
  assert.equal(fetches, 0, 'routing made a network request');
  global.fetch = realFetch;
  console.log('PASS early route: unset/ddg/no-model/incognito redirect with location.replace and no fetch');
})().catch((e) => { console.error(e); process.exitCode = 1; });

// Cloak: search.html reads only q. Anything else in the URL (mode, model, tools, provider) is ignored.
(async () => {
  const S3 = require('../src/lib/search.ts');
  const replaced = [];
  const r = await S3.earlyRoute({
    href: 'chrome-extension://x/search.html?mode=act&model=x&tools=1&provider=evil&engine=enki&q=hi',
    incognito: false,
    storageGet: async () => ({}), // unset: the URL cannot switch the engine on
    replace: (u) => replaced.push(u),
  });
  assert.equal(r.route, 'ddg');
  assert.deepEqual(Object.keys(r).sort(), ['force', 'query', 'route']);
  assert.equal(r.query, 'hi');
  assert.equal(replaced[0], 'https://duckduckgo.com/?q=hi');
  const req = S3.buildSearchRequest('configured-model', r.query, 1000);
  assert.equal(req.model, 'configured-model');
  assert.deepEqual(req.tools, []);
  assert.ok(!/act|evil|tools=1/.test(JSON.stringify(req.messages)));
  console.log('PASS search.html reads only q; mode/model/tools/provider params are ignored');
})().catch((e) => { console.error(e); process.exitCode = 1; });

// Error notice: "Search on DuckDuckGo" goes to DDG with only q; "Try again" re-runs the same query.
(async () => {
  const S4 = require('../src/lib/search.ts');
  const assigned = [], reruns = [];
  const a = S4.searchErrorActions('noise & cancelling?', { assign: (u) => assigned.push(u), rerun: (q) => reruns.push(q) });
  a.searchDdg();
  assert.equal(assigned.length, 1);
  const u = new URL(assigned[0]);
  assert.equal(u.origin + u.pathname, 'https://duckduckgo.com/');
  assert.deepEqual([...u.searchParams.keys()], ['q']);
  assert.equal(u.searchParams.get('q'), 'noise & cancelling?');
  assert.equal(a.ddgHref, assigned[0]);
  a.tryAgain(); a.tryAgain();
  assert.deepEqual(reruns, ['noise & cancelling?', 'noise & cancelling?']);
  assert.equal(assigned.length, 1, 'Try again does not navigate');
  console.log('PASS error actions: DuckDuckGo button carries only q; Try again re-runs the same query');
})().catch((e) => { console.error(e); process.exitCode = 1; });

// Error notice wording is fixed; the provider's body (which may echo a key) never reaches the page.
(async () => {
  const S5 = require('../src/lib/search.ts');
  const cases = [
    ['HTTP 429: {"error":"rate limited for key sk-test-SECRET123"}', 'limit', '429', /limit was reached/],
    ['HTTP 401 Unauthorized: invalid key sk-test-SECRET123', 'auth', '401', /API key was rejected/],
    ['403 forbidden sk-test-SECRET123', 'auth', '403', /API key was rejected/],
    ['TypeError: Failed to fetch https://SECRET123.example', 'network', undefined, /Couldn't reach/],
    ['HTTP 500 boom sk-test-SECRET123 at https://x', 'other', '500', /Something went wrong/],
  ];
  for (const [raw, kind, code, re] of cases) {
    const v = S5.describeProviderError(raw);
    assert.equal(v.kind, kind, raw); assert.equal(v.code, code, raw); assert.match(v.text, re);
    assert.ok(!JSON.stringify(v).includes('SECRET'), 'provider text leaked: ' + raw);
  }
  console.log('PASS provider errors map to fixed messages + HTTP code; raw text (sk-test-SECRET123) never shown');
})().catch((e) => { console.error(e); process.exitCode = 1; });

// Panel "Enki AI": only after Shield confirms it may run in incognito.
(async () => {
  const S6 = require('../src/lib/search.ts');
  const run = async (send) => { const sent = [], set = []; const r = await S6.chooseEnkiEngine({ send: async (id, m) => { sent.push([id, m]); return send(); }, set: async (v) => set.push(v) }); return { r, sent, set }; };
  let o = await run(() => ({ allowed: true }));
  assert.equal(o.r, 'enabled'); assert.deepEqual(o.set, ['enki']);
  assert.deepEqual(o.sent, [['aacambieennepbgemjkpailjdkldbjjf', { type: 'shield:incognitoAllowed' }]]);
  o = await run(() => ({ allowed: false }));
  assert.equal(o.r, 'needs-incognito'); assert.deepEqual(o.set, []);
  for (const bad of [() => { throw new Error('Could not establish connection. Receiving end does not exist.'); }, () => undefined, () => ({}), () => ({ allowed: 'yes' })]) {
    o = await run(bad);
    assert.equal(o.r, 'no-shield'); assert.deepEqual(o.set, []);
  }
  assert.equal(S6.SHIELD_SEARCH_URL, 'chrome-extension://aacambieennepbgemjkpailjdkldbjjf/search.html?q=%s');
  assert.equal(S6.SEARCH_ENGINES_PAGE, 'chrome://settings/searchEngines');
  assert.equal(S6.SHIELD_EXTENSIONS_PAGE, 'chrome://extensions/?id=aacambieennepbgemjkpailjdkldbjjf');
  console.log('PASS Enki AI needs Shield incognito: allowed → enki; not allowed → stays ddg + checklist; no Shield → stays ddg');
})().catch((e) => { console.error(e); process.exitCode = 1; });
