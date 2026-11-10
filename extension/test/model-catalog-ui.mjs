// Entirely mocked catalogs in an isolated extension profile. No real credentials,
// provider sessions, chat completions, microphone, or user browsing data are used.
import path from 'node:path'; import os from 'node:os';
import { mkdtemp, mkdir } from 'node:fs/promises'; import { chromium } from 'playwright'; import assert from 'node:assert/strict';
const dist=path.resolve('dist'); const context=await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'enki-catalog-')),{headless:false,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`],viewport:{width:520,height:1000}});
let checks=0; const pass=(s)=>{checks++;console.log('PASS',s);};
try {
 await context.route('https://**', r=>r.abort());
 let [sw]=context.serviceWorkers();if(!sw)sw=await context.waitForEvent('serviceworker');const id=new URL(sw.url()).host;
 const panel=await context.newPage();
 await panel.addInitScript(()=>{
  const t=window.__catalogTest={requests:[],voice:0,mic:0,peers:0,fail:false,defer:false};
  navigator.mediaDevices.getUserMedia=async()=>{t.mic++;throw new Error('unexpected mic');};
  window.RTCPeerConnection=class{constructor(){t.peers++;throw new Error('unexpected connection');}};
  window.fetch=async(url,o={})=>{
   const u=new URL(String(url));t.requests.push({url:u.href,method:o.method||'GET',auth:o.headers?.Authorization});
   if(!u.pathname.endsWith('/models')){t.voice++;throw new Error('unexpected non-catalog request');}
   if(t.fail)return new Response('test-secret-body-must-not-appear',{status:401});
   if(t.defer){t.defer=false;return new Promise(resolve=>{t.release=()=>resolve(new Response(JSON.stringify({data:[{id:'gpt-realtime-stale'}]})));});}
   if(u.hostname==='new-provider.example.test')return new Response(JSON.stringify({data:[{id:'new-provider-only'}]}));
   const all=[...Array.from({length:2000},(_,i)=>({id:'model-'+String(i).padStart(5,'0')})),{id:'gpt-realtime-future'},{id:'transcribe-future'}];
   const offset=Number(u.searchParams.get('offset')||0);const data=u.hostname==='openrouter.ai'?all.slice(offset,offset+500):all;
   return new Response(JSON.stringify({data,total_count:all.length}));
  };
 });
 await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html`);
 await panel.evaluate(()=>chrome.storage.local.set({'enki:settings':{preset:'custom',baseUrl:'https://catalog.example.test/v1',apiKey:'',model:'manual-start',settingsVersion:2,vision:false,autoApprove:false,saveConversations:false,theme:'dark',maxSteps:10}}));
 const wid=await panel.evaluate(async()=>(await chrome.windows.create({url:'about:blank',width:900,height:700})).id);
 await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html?window=${wid}`);await panel.waitForSelector('textarea');await panel.getByRole('button',{name:'Settings',exact:true}).click();await panel.getByRole('combobox',{name:'Provider',exact:true}).waitFor();
 await panel.getByText(/Model list reachable: 2002 models/).waitFor();const initial=await panel.evaluate(()=>__catalogTest.requests.length);assert.equal(initial,1);pass('key-optional custom provider loads its catalog once on open');
 const key=panel.getByLabel('API key',{exact:true}),model=panel.getByRole('combobox',{name:'Model',exact:true});
 await key.pressSequentially('fixture-not-real-key',{delay:5});assert.equal(await panel.evaluate(()=>__catalogTest.requests.length),initial);
 await model.focus();await panel.getByText(/Model list reachable: 2002 models/).waitFor();assert.equal(await panel.evaluate(()=>__catalogTest.requests.length),initial+1);pass('key completion fetches once, never per key character');
 await model.fill('model-');assert.equal(await panel.getByRole('listbox',{name:'Model suggestions',exact:true}).getByRole('option').count(),40);pass('large catalog renders no more than 40 searchable options');
 await model.fill('model-01999');assert.equal(await panel.getByRole('listbox',{name:'Model suggestions',exact:true}).getByRole('option').count(),1);await panel.keyboard.press('ArrowDown');await panel.keyboard.press('Enter');assert.equal(await model.inputValue(),'model-01999');pass('search reaches late catalog entries and keyboard selection works');
 await model.fill('brand-new-manual-id');await panel.keyboard.press('Escape');assert.equal(await panel.evaluate(()=>__catalogTest.requests.length),initial+1);pass('manual IDs accepted and filtering never calls provider');
 assert.equal(await panel.getByLabel('Voice provider',{exact:true}).inputValue(),'');assert.equal(await panel.getByLabel('Full HTTPS calls endpoint',{exact:true}).inputValue(),'');assert.equal(await panel.getByLabel('Realtime credential',{exact:true}).inputValue(),'');
 await panel.getByRole('heading',{name:'Suggested live voice setup',exact:true}).waitFor();await panel.getByText('Live voice compatibility not verified.',{exact:false}).waitFor();pass('catalog suggestions neither fill voice settings nor claim verified access');
 await panel.getByLabel('Voice provider',{exact:true}).fill('Independent voice service');await panel.getByLabel('Realtime model',{exact:true}).fill('my-edited-voice-id');
 await panel.getByRole('button',{name:'Fill empty voice fields from suggestions',exact:true}).click();assert.equal(await panel.getByLabel('Voice provider',{exact:true}).inputValue(),'Independent voice service');assert.equal(await panel.getByLabel('Realtime model',{exact:true}).inputValue(),'my-edited-voice-id');assert.equal(await panel.getByLabel('Full HTTPS calls endpoint',{exact:true}).inputValue(),'');pass('explicit fill preserves edits and does not guess custom endpoints or copy a key');
 await panel.getByRole('button',{name:'Refresh models',exact:true}).click();await panel.getByText(/Model list reachable: 2002 models/).waitFor();assert.equal(await model.inputValue(),'brand-new-manual-id');assert.equal(await panel.getByLabel('Realtime model',{exact:true}).inputValue(),'my-edited-voice-id');pass('refresh preserves manual text/voice selections');
 await panel.evaluate(()=>__catalogTest.defer=true);await key.fill('fixture-second-key');await model.focus();await panel.getByText('Loading model catalog…',{exact:true}).waitFor();await panel.waitForFunction(()=>typeof __catalogTest.release==='function');
 const base=panel.getByLabel('Base URL',{exact:true});await base.fill('https://new-provider.example.test/v1');await model.focus();await panel.getByText(/Model list reachable: 1 models/).waitFor();await panel.evaluate(()=>__catalogTest.release());
 await model.fill('stale');assert.equal(await panel.getByRole('listbox',{name:'Model suggestions',exact:true}).getByRole('option').count(),0);await model.fill('new-provider-only');assert.equal(await panel.getByRole('listbox',{name:'Model suggestions',exact:true}).getByRole('option').count(),1);pass('endpoint changes abort old lookup and discard late stale responses');await panel.keyboard.press('Escape');
 await panel.getByRole('combobox',{name:'Provider',exact:true}).selectOption('openrouter');assert.equal(await key.inputValue(),'');const beforeRouter=await panel.evaluate(()=>__catalogTest.requests.length);await key.fill('fixture-router-key');await model.focus();await panel.getByText(/Model list reachable: 2002 models/).waitFor();
 const router=await panel.evaluate(n=>__catalogTest.requests.slice(n),beforeRouter);assert.equal(router.length,5);assert.ok(router.every(r=>new URL(r.url).origin==='https://openrouter.ai'&&new URL(r.url).searchParams.get('output_modalities')==='all'&&r.auth==='Bearer fixture-router-key'));
 assert.equal(await panel.getByLabel('Voice provider',{exact:true}).inputValue(),'Independent voice service');pass('OpenRouter loads all catalog pages with its own key and does not reconfigure independent voice');
 await panel.getByLabel('Full HTTPS calls endpoint',{exact:true}).fill('https://voice-other.example.test/v1/realtime/calls');assert.equal(await panel.getByRole('button',{name:'Use this provider key for voice',exact:true}).isDisabled(),true);pass('cross-provider credential reuse is disabled');
 await panel.getByRole('combobox',{name:'Provider',exact:true}).selectOption('openai');assert.equal(await key.inputValue(),'');await key.fill('fixture-openai-key');await model.focus();await panel.getByText(/Model list reachable: 2002 models/).waitFor();
 await panel.getByLabel('Full HTTPS calls endpoint',{exact:true}).fill('https://api.openai.com/v1/realtime/calls');await panel.getByRole('button',{name:'Use this provider key for voice',exact:true}).click();assert.equal(await panel.getByLabel('Realtime credential',{exact:true}).inputValue(),'');await panel.getByText(/Provider key copied to voice settings by your explicit choice/).waitFor();pass('same-origin key reuse requires an explicit click and stays masked');
 const beforeSaved=await panel.evaluate(()=>__catalogTest.requests.length);await panel.getByRole('button',{name:'Save',exact:true}).click();await panel.getByRole('button',{name:'Settings',exact:true}).click();await panel.getByText(/Cached model catalog: 2002 models/).waitFor();assert.equal(await panel.evaluate(()=>__catalogTest.requests.length),beforeSaved);pass('reopening saved provider uses credential-scoped memory cache');
 await panel.evaluate(()=>__catalogTest.fail=true);await panel.getByRole('button',{name:'Refresh models',exact:true}).click();await panel.getByText(/Could not load the model catalog/).waitFor();assert.equal((await panel.locator('body').innerText()).includes('test-secret-body-must-not-appear'),false);await model.fill('manual-after-failure');await panel.keyboard.press('Escape');assert.equal(await model.inputValue(),'manual-after-failure');pass('catalog errors are redacted with a working manual fallback and no synthetic chat');
 await panel.getByRole('button',{name:'Refresh models',exact:true}).click();await panel.getByText(/Could not load the model catalog/).waitFor();assert.deepEqual(await panel.evaluate(()=>[__catalogTest.mic,__catalogTest.peers,__catalogTest.voice]),[0,0,0]);assert.ok((await panel.evaluate(()=>__catalogTest.requests)).every(r=>r.method==='GET'&&new URL(r.url).pathname.endsWith('/models')));pass('all detection/search/refresh flows are GET catalogs only, with no voice/probe/mic/chat');
 await mkdir('test-results',{recursive:true});await panel.screenshot({path:'test-results/model-catalog-manual-fallback.png'});
} finally {await context.close();}
console.log(`Model catalog UI: ${checks} checks passed (mock catalogs only).`);
