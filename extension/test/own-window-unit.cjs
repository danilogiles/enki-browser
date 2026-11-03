// #115: a page's window follows its tab when torn off; the side panel (no tab) keeps its window.
const ts = require('typescript');
const fs = require('node:fs');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { followOwnWindow } = require('../src/lib/own-window.ts');

function fakeApi(tab, windowId) {
  const listeners = new Set();
  return {
    listeners,
    attach: (tabId, newWindowId) => { for (const l of [...listeners]) l(tabId, { newWindowId }); },
    tabs: {
      getCurrent: async () => tab,
      onAttached: { addListener: (l) => listeners.add(l), removeListener: (l) => listeners.delete(l) },
    },
    windows: { getCurrent: async () => ({ id: windowId }) },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log('PASS', name); }

(async () => {
  await check('page in a tab: starts on its window, follows its own tab on tear-off', async () => {
    const api = fakeApi({ id: 7, windowId: 1 }, 1);
    const seen = [];
    followOwnWindow((id) => seen.push(id), api);
    await tick();
    assert.deepEqual(seen, [1]);
    api.attach(7, 2);           // torn off into window 2
    assert.deepEqual(seen, [1, 2], 'synchronous, so the next click has it without an await');
    api.attach(9, 3);           // some other tab moved: ignored
    api.attach(7, 2);           // duplicate: ignored
    assert.deepEqual(seen, [1, 2]);
    api.attach(7, 1);           // dragged back
    assert.deepEqual(seen, [1, 2, 1]);
  });
  await check('side panel (no tab): docking window once, other tabs moving never rebind it', async () => {
    const api = fakeApi(undefined, 4);
    const seen = [];
    followOwnWindow((id) => seen.push(id), api);
    await tick(); await tick();
    assert.deepEqual(seen, [4]);
    api.attach(7, 5);
    assert.deepEqual(seen, [4]);
  });
  await check('unsubscribe removes the listener and drops late results', async () => {
    const api = fakeApi({ id: 7, windowId: 1 }, 1);
    const seen = [];
    const off = followOwnWindow((id) => seen.push(id), api);
    off();
    await tick();
    api.attach(7, 2);
    assert.deepEqual(seen, []);
    assert.equal(api.listeners.size, 0);
  });
  console.log(`own-window: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
