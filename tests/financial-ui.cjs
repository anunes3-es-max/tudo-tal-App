// npm ci --prefix tests && node tests/financial-ui.cjs
// DOM integration with synthetic server responses; no live account or transactions.
const {JSDOM}=require('jsdom');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const report={from:'2026-10-17',to:'2026-10-17',generated_at:'2026-10-17T18:00:00Z',token:'snapshot-1',sold:500,opening:0,inflow:100,outflow:25,balance:75,cash_opening:0,cash_balance:25,unknown_balance:0,vip_pending:400,owner_pending:0,methods:[{method:'Pix',inflow:100,outflow:25,net:75}],movements:[{id:'cash:manual',occurred_at:'2026-10-17T18:00:00Z',amount:-25,method:'Pix',category:'Despesas',description:'Embalagens & etiquetas',metadata:{}}],events:[],pending:[{id:'pending-1',kind:'card',amount:100,expected_fee:3,description:'Confirmar cartão',product_name:'Produto QA'}],closures:[]};
(async()=>{
 const dom=new JSDOM(html,{url:'https://qa.example.invalid/',runScripts:'outside-only'}),w=dom.window,ctx=dom.getInternalVMContext();
 await tick();
 w.structuredClone=structuredClone;w.TextEncoder=TextEncoder;w.scrollTo=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 const errors=[],calls=[];let rejectPassword=false,exported;
 w.addEventListener('error',e=>errors.push(e.error));
 w.tudoTalCloud={syncAndRefresh:async()=>true};
 w.tudoTalSupabase={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='finance_report'?structuredClone(report):{status:'applied'},error:null}},auth:{getUser:async()=>({data:{user:{id:'qa-admin',email:'admin@example.invalid'}},error:null}),signInWithPassword:async()=>rejectPassword?{data:{},error:{message:'invalid'}}:{data:{user:{id:'qa-admin'}},error:null}},from:()=>({select:()=>({eq:()=>({order:async()=>({data:[],error:null}),single:async()=>({data:{snapshot:report,revision:1},error:null})})})})};
 for(const file of ['app-1.js','app-4.js','finance.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
 vm.runInContext(`state.view='caixa';state.products=[{id:'p1',name:'Produto QA',qty:2,price:100}];state.sales=[{id:'s1',productId:'p1',productName:'<img src=x onerror=alert(1)>',sku:'SKU-1',date:'2026-10-17T18:00:00Z',qty:1,total:100,unitPrice:100,payment:'Pix',status:'Ativa',revision:0,originalData:{total:100},mode:'proprio'}];`,ctx);
 w.downloadFinancePdf=(r)=>{exported=r};
 w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 const $=s=>w.document.querySelector(s);
 const ids=[...w.document.querySelectorAll('[id]')].map(x=>x.id);assert.equal(new Set(ids).size,ids.length,'duplicate element IDs');
 for(const el of w.document.querySelectorAll('script[src],link[rel=stylesheet]')){const url=el.getAttribute('src')||el.getAttribute('href');if(!/^https?:/.test(url))assert(fs.existsSync(path.join(root,url.split('?')[0])),url);}
 const math=w.TudoTalFinanceMath;assert.deepEqual(Array.from(math.range('week','2026-10-18')),['2026-10-12','2026-10-18']);assert.deepEqual(Array.from(math.range('month','2026-02-15')),['2026-02-01','2026-02-28']);
 await w.renderCash();assert.match($('#financeSummary').textContent,/500,00/);assert.match($('#cashList').textContent,/Embalagens & etiquetas/);assert.equal($('#financePdf').disabled,false);
 $('#financePdf').click();await tick();assert.equal(exported.token,'snapshot-1');
 w.renderSalesHistory();assert.equal($('#salesHistoryList').querySelector('img'),null,'product name injected HTML');
 $('[data-fin-sale]').click();await tick();assert($('#financeActionDialog').open);assert.equal($('#financeSaleAction').value,'price');
 $('#financeUnit').value='80';$('#financeUnit').dispatchEvent(new w.Event('input'));$('#financeReason').value='Preço digitado incorretamente';
 $('#financeActionForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert($('#financeAuthDialog').open);assert(!calls.some(c=>c.name==='finance_change_sale'));
 rejectPassword=true;$('#financePassword').value='senha-de-teste';$('#financeAuthForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert($('#financeAuthDialog').open);assert.equal($('#financePassword').value,'');assert(!calls.some(c=>c.name==='finance_change_sale'));
 rejectPassword=false;$('#financePassword').value='senha-de-teste';$('#financeAuthForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();await tick();
 const change=calls.find(c=>c.name==='finance_change_sale');assert.equal(change.args.p_data.unit_price,80);assert.equal(change.args.p_revision,0);assert.equal(change.args.p_reason,'Preço digitado incorretamente');assert(!$('#financeActionDialog').open);assert(!$('#financeAuthDialog').open);
 $('#financeClose').click();assert($('#financeActionDialog').open);assert.match($('#financeActionBody').textContent,/25,00/);$('#financeActionCancel').click();
 $('[data-fin-settle]').click();assert.equal($('#financeMethod').value,'Transferência');assert.match($('#financeActionBody').textContent,/não consulta a maquininha/);$('#financeActionCancel').click();
 vm.runInContext(`state.sales.push({id:'owner1',owner:'Dona QA',mode:'consignado',repasse:75,repassePaidAmount:0});`,ctx);w.markOwnerPaid(encodeURIComponent('Dona QA'));assert(![...$('#financeMethod').options].some(o=>o.value==='Não informado'));$('#financeActionCancel').click();
 assert.deepEqual(errors,[]);dom.window.close();console.log('PASS: real HTML/scripts, date periods, escaped history, report/PDF selection, sale correction, password failure and success, settlement and owner controls.');
})().catch(e=>{console.error(e);process.exitCode=1});
