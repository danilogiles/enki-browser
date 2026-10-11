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
  await check('auth and rate-limit errors fall back to DuckDuckGo', () => {
    assert.ok(S.isFallbackError('HTTP 401 Unauthorized'));
    assert.ok(S.isFallbackError('429 Too Many Requests'));
    assert.ok(!S.isFallbackError('socket hang up'));
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
