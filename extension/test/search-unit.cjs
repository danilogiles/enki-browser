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
  await check('Shield messages: wrong sender rejected, bad values/fields rejected, get/set work; first search finishes pending setup', async () => {
    const mk = (engine, pending) => { const io = { engine, pending, just: 0,
      get: async () => io.engine, setEngine: async (v) => { io.engine = v; }, getPending: async () => io.pending,
      setPending: async (v) => { io.pending = v; }, setJustSetUp: async () => { io.just++; } }; return io; };
    const shield = { id: S.SHIELD_EXTENSION_ID };
    let io = mk(undefined, false);
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:setSearchEngine', value: 'enki' }, { id: 'evil' }, io), { ok: false, error: 'forbidden' });
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:getSearchEngine', incognitoAllowed: true }, {}, io), { ok: false, error: 'forbidden' });
    assert.equal(io.engine, undefined);
    for (const value of ['ENKI', 'google', '', null, ['enki'], { toString: () => 'enki' }])
      assert.deepEqual(await S.handleExternalMessage({ type: 'enki:setSearchEngine', value }, shield, io), { ok: false, error: 'invalid value' });
    assert.deepEqual(await S.handleExternalMessage({ type: 'other' }, shield, io), { ok: false, error: 'unknown message' });
    assert.deepEqual(await S.handleExternalMessage(null, shield, io), { ok: false, error: 'unknown message' });
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:getSearchEngine' }, shield, io), { ok: true, value: null });
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:setSearchEngine', value: 'enki' }, shield, io), { ok: true });
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:getSearchEngine' }, shield, io), { ok: true, value: 'enki' });
    // pending + incognitoAllowed:true -> enki, pending cleared, one-shot set
    io = mk('ddg', true);
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:getSearchEngine', incognitoAllowed: true }, shield, io), { ok: true, value: 'enki' });
    assert.equal(io.engine, 'enki'); assert.equal(io.pending, false); assert.equal(io.just, 1);
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:getSearchEngine', incognitoAllowed: true }, shield, io), { ok: true, value: 'enki' });
    assert.equal(io.just, 1, 'one-shot set only once');
    // no pending -> no change
    io = mk('ddg', false);
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:getSearchEngine', incognitoAllowed: true }, shield, io), { ok: true, value: 'ddg' });
    assert.equal(io.engine, 'ddg'); assert.equal(io.just, 0);
    // allowed false -> no change
    io = mk('ddg', true);
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:getSearchEngine', incognitoAllowed: false }, shield, io), { ok: true, value: 'ddg' });
    assert.equal(io.pending, true); assert.equal(io.just, 0);
    // bad field / non-boolean rejected, nothing changes
    for (const m of [{ type: 'enki:getSearchEngine', incognitoAllowed: 'true' }, { type: 'enki:getSearchEngine', incognitoAllowed: 1 },
      { type: 'enki:getSearchEngine', incognitoAllowed: true, q: 'x' }, { type: 'enki:getSearchEngine', engine: 'enki' }]) {
      assert.deepEqual(await S.handleExternalMessage(m, shield, io), { ok: false, error: 'invalid message' }, JSON.stringify(m));
    }
    assert.equal(io.engine, 'ddg'); assert.equal(io.pending, true); assert.equal(io.just, 0);
  });
  await check('non-Shield senders cannot enable Enki, clear pending, or set the one-shot flag', async () => {
    const io = { engine: 'ddg', pending: true, just: 0, writes: [],
      get: async () => io.engine, setEngine: async (v) => { io.writes.push(v); io.engine = v; }, getPending: async () => io.pending,
      setPending: async (v) => { io.writes.push('pending:' + v); io.pending = v; }, setJustSetUp: async () => { io.just++; } };
    const senders = [
      { id: 'abcdefghijklmnopabcdefghijklmnop' },                       // another extension
      { id: S.SHIELD_EXTENSION_ID.toUpperCase() },                       // look-alike id
      { url: 'https://evil.example/', origin: 'https://evil.example' },  // web origin, no id
      { origin: 'https://evil.example', id: undefined },
      {}, null, undefined,
    ];
    for (const sender of senders) for (const msg of [{ type: 'enki:getSearchEngine', incognitoAllowed: true }, { type: 'enki:setSearchEngine', value: 'enki' }]) {
      assert.deepEqual(await S.handleExternalMessage(msg, sender, io), { ok: false, error: 'forbidden' }, JSON.stringify([sender, msg]));
    }
    assert.equal(io.engine, 'ddg'); assert.equal(io.pending, true); assert.equal(io.just, 0); assert.deepEqual(io.writes, []);
  });
  await check('search.html one-shot "AI search is set up": shown once, then cleared', async () => {
    let v = true; const io = { get: async () => v, clear: async () => { v = undefined; } };
    assert.equal(await S.takeJustSetUp(io), true);
    assert.equal(await S.takeJustSetUp(io), false);
    assert.equal(await S.takeJustSetUp({ get: async () => 'true', clear: async () => { throw new Error('should not clear'); } }), false);
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

// Panel "Enki AI": saved only after both setup steps; until then a pending intent flag, engine stays ddg.
(async () => {
  const S6 = require('../src/lib/search.ts');
  const mkIO = (pending = false, reply) => {
    const io = { engine: [], pendingLog: [], pending, sent: [],
      setEngine: async (v) => io.engine.push(v), getPending: async () => io.pending,
      setPending: async (v) => { io.pending = v; io.pendingLog.push(v); },
      send: async (id, m) => { io.sent.push([id, m]); return typeof reply === 'function' ? reply() : reply; } };
    return io;
  };
  // both done -> enki now
  let io = mkIO(false, { allowed: true, searchSetupDone: true });
  let r = await S6.chooseEnkiEngine(io);
  assert.equal(r.result, 'enabled'); assert.deepEqual(io.engine, ['enki']); assert.equal(io.pending, false);
  assert.deepEqual(io.sent, [['aacambieennepbgemjkpailjdkldbjjf', { type: 'shield:incognitoAllowed' }]]);
  // allowed only / nothing done -> pending, engine stays ddg
  for (const reply of [{ allowed: true, searchSetupDone: false }, { allowed: true }, { allowed: false, searchSetupDone: true }, { allowed: false, searchSetupDone: false }]) {
    io = mkIO(false, reply); r = await S6.chooseEnkiEngine(io);
    assert.equal(r.result, 'pending', JSON.stringify(reply)); assert.ok(!io.engine.includes('enki')); assert.equal(io.pending, true);
  }
  // Shield missing or malformed -> no-shield, no flag, no enki
  for (const bad of [() => { throw new Error('Receiving end does not exist.'); }, () => undefined, () => ({}), () => ({ allowed: 'yes' }), () => ({ allowed: true, searchSetupDone: 'yes' })]) {
    io = mkIO(false, bad); r = await S6.chooseEnkiEngine(io);
    assert.equal(r.result, 'no-shield'); assert.deepEqual(io.engine, []); assert.equal(io.pending, false); assert.equal(r.status, null);
  }
  // reconcile: pending + both done -> enki, flag cleared
  io = mkIO(true); assert.equal(await S6.reconcileSearchSetup({ allowed: true, searchSetupDone: true }, 'ddg', io), 'enabled');
  assert.deepEqual(io.engine, ['enki']); assert.equal(io.pending, false);
  // reconcile: not pending -> nothing, even if both done
  io = mkIO(false); assert.equal(await S6.reconcileSearchSetup({ allowed: true, searchSetupDone: true }, 'ddg', io), 'unchanged'); assert.deepEqual(io.engine, []);
  // reconcile: pending, one step missing -> stays
  io = mkIO(true); assert.equal(await S6.reconcileSearchSetup({ allowed: true, searchSetupDone: false }, 'ddg', io), 'unchanged'); assert.deepEqual(io.engine, []); assert.equal(io.pending, true);
  // paused: on enki and incognito access removed (or Shield gone) -> ddg + pending
  for (const st of [{ allowed: false, searchSetupDone: true }, null]) {
    io = mkIO(false); assert.equal(await S6.reconcileSearchSetup(st, 'enki', io), 'paused');
    assert.deepEqual(io.engine, ['ddg']); assert.equal(io.pending, true);
  }
  io = mkIO(false); assert.equal(await S6.reconcileSearchSetup({ allowed: true, searchSetupDone: false }, 'enki', io), 'unchanged', 'setup step 2 never pauses an active Enki');
  // DuckDuckGo clears the flag
  io = mkIO(true); await S6.chooseDdgEngine(io); assert.deepEqual(io.engine, ['ddg']); assert.equal(io.pending, false);
  assert.equal(S6.SETUP_PENDING_KEY, 'enki:searchSetupPending');
  const extra = await S6.queryShieldStatus(async () => ({ allowed: true, searchSetupDone: true, enginePref: 'x' }));
  assert.deepEqual(extra, { allowed: true, searchSetupDone: true }, 'only the two booleans are read');
  assert.equal(S6.SHIELD_SEARCH_URL, 'chrome-extension://aacambieennepbgemjkpailjdkldbjjf/search.html?q=%s');
  assert.equal(S6.SEARCH_ENGINES_PAGE, 'chrome://settings/searchEngines');
  assert.equal(S6.SHIELD_EXTENSIONS_PAGE, 'chrome://extensions/?id=aacambieennepbgemjkpailjdkldbjjf');
  assert.equal(S6.UBLOCK_EXTENSIONS_PAGE, 'chrome://extensions/?id=nadeplcfbngnnnppbenfiicgnimdcaaj');
  {
    // The uBOL id must be the one the build gives the bundled uBlock (from config/ublock-extension.pub).
    const fs = require('fs'), path = require('path'), crypto = require('crypto');
    const key = fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'ublock-extension.pub'), 'utf8').trim();
    const hex = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
    assert.equal(S6.UBLOCK_EXTENSION_ID, [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(''));
    // No new permission for the uBlock line (no "management"): the manifest list is unchanged.
    const man = fs.readFileSync(path.join(__dirname, '..', 'manifest.config.ts'), 'utf8');
    const perms = [...man.match(/\bpermissions:\s*\[([^\]]*)\]/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(perms, ['sidePanel', 'activeTab', 'tabs', 'scripting', 'storage', 'debugger', 'webNavigation', 'declarativeNetRequestWithHostAccess']);
    assert.ok(!man.includes('"management"'));
  }
  console.log('PASS Enki AI only after both steps: pending flag, reconcile enables/pauses, DuckDuckGo clears; bad replies = no Shield');
})().catch((e) => { console.error(e); process.exitCode = 1; });

// 0.8.10 "Search engine" setting: three options, Other never calls AI, no model never enables Enki.
(async () => {
  const mem = () => { const st = { engine: undefined, pending: false, sent: [] }; return { st,
    setEngine: async (v) => { if (!S.isSearchEngine(v)) throw new Error('bad'); st.engine = v; },
    getPending: async () => st.pending, setPending: async (v) => { st.pending = v; },
    send: async (id, m) => { st.sent.push(m); return { allowed: true, searchSetupDone: true }; } }; };
  await check('setting: other is a valid, persisted engine; ddg and other clear pending', async () => {
    const io = mem(); io.st.pending = true;
    await S.chooseOtherEngine(io); assert.equal(io.st.engine, 'other'); assert.equal(io.st.pending, false);
    await S.chooseDdgEngine(io); assert.equal(io.st.engine, 'ddg');
    assert.ok(S.isSearchEngine('other')); assert.ok(!S.isSearchEngine('google'));
  });
  await check('setting: storage round-trip through chrome.storage.local', async () => {
    const store = {}; global.chrome = { storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } } };
    await S.setSearchEngine('other'); assert.equal(await S.getSearchEngine(), 'other');
    store[S.SEARCH_ENGINE_KEY] = 'bogus'; assert.equal(await S.getSearchEngine(), undefined);
    delete global.chrome;
  });
  await check('Enki AI is not enabled without a model, even with Shield setup done', async () => {
    const io = mem(); const r = await S.chooseEnkiEngine({ ...io, hasModel: false });
    assert.equal(r.result, 'pending'); assert.notEqual(io.st.engine, 'enki'); assert.equal(io.st.pending, true);
    assert.equal(await S.reconcileSearchSetup({ allowed: true, searchSetupDone: true }, 'ddg', io, false), 'unchanged');
    const io2 = mem(); assert.equal((await S.chooseEnkiEngine({ ...io2, hasModel: true })).result, 'enabled');
    assert.equal(S.decideRoute({ engine: 'enki', incognito: false, hasModel: false, query: 'a b' }), 'ddg');
  });
  await check('Other never calls AI: search.html goes to DuckDuckGo with only q, incognito too', async () => {
    assert.equal(S.decideRoute({ engine: 'other', incognito: false, hasModel: true, query: 'best headphones' }), 'ddg');
    for (const incognito of [false, true]) {
      let replaced; const r = await S.earlyRoute({ href: 'chrome-extension://x/search.html?q=best+headphones', incognito,
        storageGet: async () => ({ [S.SEARCH_ENGINE_KEY]: 'other', 'enki:settings': { preset: 'openai', model: 'm', apiKeys: { openai: 'k' } } }),
        replace: (u) => { replaced = u; } });
      assert.equal(r.route, 'ddg'); assert.equal(replaced, 'https://duckduckgo.com/?q=best+headphones');
    }
  });
  await check('Shield sees other as ddg and cannot set other', async () => {
    const io = { ...mem(), get: async () => 'other', setJustSetUp: async () => {} };
    assert.deepEqual(await S.handleExternalMessage({ type: 'enki:getSearchEngine' }, { id: S.SHIELD_EXTENSION_ID }, io), { ok: true, value: 'ddg' });
    assert.equal((await S.handleExternalMessage({ type: 'enki:setSearchEngine', value: 'other' }, { id: S.SHIELD_EXTENSION_ID }, io)).ok, false);
  });
  await check('option text (mocks 02/04): provider + Cloak line; the model line only without a model', () => {
    const full = "Searches go to your AI provider (OpenRouter · Ask). Only what you type is sent, not your tabs or history. Your provider may search the web to answer.";
    assert.equal(S.enkiOptionText('OpenRouter', true), full);
    assert.ok(!S.enkiOptionText('OpenRouter', true).includes('Needs a model'));
    assert.equal(S.enkiOptionText('OpenRouter', false), "Searches go to your AI provider. Only what you type is sent, not your tabs or history. Your provider may search the web to answer. Needs a model set up in Settings.");
    assert.ok(!S.enkiOptionText(undefined, false).includes('('));
    assert.ok(S.SEARCH_OPTION_TEXT.otherHowTo.endsWith('⋮\u00a0›\u00a0Make\u00a0default.'));
    assert.equal(S.providerShortName({ preset: 'ollama', model: 'llama3' }), 'Ollama');
  });
})().catch((e) => { console.error(e); process.exitCode = 1; });
