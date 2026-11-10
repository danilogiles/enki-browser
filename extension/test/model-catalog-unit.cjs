const ts = require('typescript'); const fs = require('node:fs'); const assert = require('node:assert/strict'); const { test } = require('node:test');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, f);
globalThis.crypto ??= require('node:crypto').webcrypto;
const { normalizeCatalog, suggestedRealtimeEndpoint, sameCredentialOrigin, readCatalogJson, catalogIdentity, cachedCatalog, cacheCatalog } = require('../src/lib/providers/model-catalog.ts');
const { OpenAICompatProvider } = require('../src/lib/providers/openai-compat.ts');
test('catalog accepts future IDs, deduplicates, bounds rows and rejects malformed/control data', () => {
 const a = normalizeCatalog([{id:'future-model'}, {id:'future-model'}, {id:'bad\nvalue'}, {}, 1, null, 'manual-model']); assert.deepEqual(a.map(x=>x.id), ['future-model','manual-model']);
 assert.throws(()=>normalizeCatalog({})); assert.throws(()=>normalizeCatalog(Array(50001).fill('x')));
});
test('audio modalities never imply realtime; names remain explicitly unverified hints', () => {
 const a=normalizeCatalog([{id:'audio-only',architecture:{output_modalities:['audio']}},{id:'gpt-realtime-new'},{id:'declared',endpoints:['realtime']}]);
 assert.equal(a.find(x=>x.id==='audio-only').realtime,undefined); assert.equal(a.find(x=>x.id==='gpt-realtime-new').realtime,'name-hint'); assert.equal(a.find(x=>x.id==='declared').realtime,'reported');
 assert.equal(normalizeCatalog(a).find(x=>x.id==='declared').realtime,'reported');
});
test('only documented OpenAI GA name hints suggest a calls URL, never custom/GPT-Live URLs', () => {
 assert.equal(suggestedRealtimeEndpoint('https://api.openai.com/v1','gpt-realtime-future'),'https://api.openai.com/v1/realtime/calls');
 for(const base of ['https://openrouter.ai/api/v1','https://api.openai.com.evil.test/v1','https://api.openai.com/v1?x=1']) assert.equal(suggestedRealtimeEndpoint(base,'gpt-realtime-new'),'');
 assert.equal(suggestedRealtimeEndpoint('https://api.openai.com/v1','gpt-live-1'),'');
});
test('explicit key reuse only accepts exact HTTPS origins without URL credentials/query', () => {
 assert.equal(sameCredentialOrigin('https://voice.test/v1','https://voice.test/voice/calls'),true);
 for(const b of ['https://other.test/calls','http://voice.test/calls','https://key@voice.test/calls','https://voice.test/calls?key=x','https://voice.test:8443/calls']) assert.equal(sameCredentialOrigin('https://voice.test/v1',b),false);
});
test('catalog cache uses opaque per-credential identities, TTL and bounded entries', async () => {
 const a=await catalogIdentity({key:'test-secret-a',base:'https://a.test'}),b=await catalogIdentity({key:'test-secret-b',base:'https://a.test'}); assert.notEqual(a,b); assert.equal(a.includes('test-secret'),false);
 cacheCatalog(a,[{id:'a'}],1000); assert.equal(cachedCatalog(a,1001)[0].id,'a'); assert.equal(cachedCatalog(a,301000),undefined);
 for(let i=0;i<5;i++) cacheCatalog('bounded-'+i,[{id:String(i)}],1000); assert.equal(cachedCatalog('bounded-0',1001),undefined);
});
test('catalog JSON streaming enforces response budget', async () => {
 assert.deepEqual(await readCatalogJson(new Response('{"data":[]}')),{data:[]});
 await assert.rejects(readCatalogJson(new Response('x'.repeat(8*1024*1024+1))),/too large/);
});
test('OpenRouter catalogs paginate all modalities on the configured origin and preserve metadata', async () => {
 const old=global.fetch; const seen=[];
 global.fetch=async (url,o)=>{ seen.push([url,o]); const offset=Number(new URL(url).searchParams.get('offset')); return new Response(JSON.stringify({data:Array.from({length:offset?7:500},(_,i)=>({id:'m-'+(offset+i),architecture:{output_modalities:['audio']}})),total_count:507})); };
 try { const p=new OpenAICompatProvider({baseUrl:'https://openrouter.ai/api/v1',apiKey:'fixture-key'});const a=await p.listModelCatalog();assert.equal(a.length,507);assert.equal(seen.length,2);for(const [u,o] of seen){assert.equal(new URL(u).origin,'https://openrouter.ai');assert.equal(new URL(u).searchParams.get('output_modalities'),'all');assert.equal(o.headers.Authorization,'Bearer fixture-key');assert.equal(o.redirect,'error');assert.equal(o.credentials,'omit');}assert.equal(a[0].realtime,undefined); }finally{global.fetch=old;}
});
test('catalog pre-abort is inert and failures do not disclose provider body/key', async()=>{
 const old=global.fetch;let n=0;global.fetch=async()=>{n++;return new Response('fixture-key must-not-echo',{status:401});};
 try{const p=new OpenAICompatProvider({baseUrl:'https://provider.test/v1',apiKey:'fixture-key'});const c=new AbortController();c.abort();await assert.rejects(p.listModels(c.signal));assert.equal(n,0);await assert.rejects(p.listModels(),(e)=>/401/.test(e.message)&&!e.message.includes('fixture-key')&&!e.message.includes('must-not-echo'));assert.equal(n,1);}finally{global.fetch=old;}
});
