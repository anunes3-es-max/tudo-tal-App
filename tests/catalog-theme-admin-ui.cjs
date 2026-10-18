const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
 const dom=new JSDOM('<section id="view-config"><div class="catalog-config-panel"></div></section>',{url:'https://example.invalid/',runScripts:'outside-only'}),w=dom.window,calls=[];
 let current={theme:'default',title:'',message:'',starts_at:null,ends_at:null,version:0,active_theme:'default',server_time:'2026-10-18T12:00:00Z'};
 w.tudoTalSupabase={rpc:async(name,p)=>{calls.push({name,p});if(name==='save_catalog_appearance')current={...current,theme:p.p_theme,starts_at:p.p_starts_at,ends_at:p.p_ends_at,version:current.version+1};return{data:current};}};
 w.eval(fs.readFileSync(__dirname+'/../catalog-theme-admin.js','utf8'));await w.initCatalogAppearance();
 const q=id=>w.document.getElementById('appearance'+id);q('Theme').value='natal';q('Theme').dispatchEvent(new w.Event('change'));q('Preview').click();assert.equal(calls.length,1,'Preview wrote to database');
 q('Mode').value='scheduled';q('Mode').dispatchEvent(new w.Event('change'));q('Start').value='2026-12-01T08:00';q('End').value='2026-12-26T00:00';q('Form').dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,0));
 assert.equal(calls[1].p.p_starts_at,'2026-12-01T11:00:00.000Z');assert.equal(calls[1].p.p_ends_at,'2026-12-26T03:00:00.000Z');assert.equal(calls[1].p.p_version,0);
 await w.initCatalogAppearance();assert.equal(w.document.querySelectorAll('#catalogAppearancePanel').length,1);dom.window.close();console.log('PASS: preview read-only, UTC-3 schedule, version token, single panel');
})().catch(e=>{console.error(e);process.exitCode=1});
