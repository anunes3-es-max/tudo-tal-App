const {JSDOM}=require('jsdom');const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');const tick=()=>new Promise(r=>setImmediate(r));
async function run(role){
 const dom=new JSDOM(html,{url:'https://qa.invalid',runScripts:'outside-only'}),w=dom.window,calls=[],errors=[];
 w.matchMedia=()=>({matches:false});w.alert=m=>errors.push(m);w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 w.localStorage.setItem('tdtCacheOwner','test-'+role);
 const product={id:'p1',sku:'SKU1',name:'Produto <QA>',price:100,discount_percent:10,qty:10,category:'Perfumes',photo_url:''};
 w.tudoTalSupabase={rpc:async(name,args)=>{calls.push({name,...args});let data={};switch(args.p_action){case 'stock':data=[product];break;case 'sessions':case 'my_sales':case 'my_requests':data=[];break;case 'panel':data={slots:[1,2].map(slot=>({slot,name:'',email:'',phone:'',enabled:false})),requests:[],events:[]};break;case 'checkout':data={status:'registered',total:90};break;}return{data,error:null};},auth:{mfa:{listFactors:async()=>({data:{totp:[]}})}}};
 vm.runInContext(fs.readFileSync('access-control.js','utf8'),dom.getInternalVMContext());
 await w.tdtAccess.init({user_id:'test-'+role,role,name:'Pessoa QA'});
 if(role==='staff'){
   assert(w.document.body.classList.contains('seller-mode'));assert.equal(w.document.querySelector('#sellerProducts img').getAttribute('src'),'assets/icon.svg');assert(w.document.querySelector('#sellerProducts').textContent.includes('Produto <QA>'));
   w.document.querySelector('[data-add]').click();assert(w.document.querySelector('#sellerCart').textContent.includes('90,00'));
   w.document.querySelector('[data-remove]').click();assert(w.document.querySelector('#sellerCart').textContent.includes('0,00'));
   w.document.querySelector('#sellerSearch').value='SKU1';w.document.querySelector('#sellerSearch').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter'}));
   w.document.querySelector('#sellerFinish').click();await tick();await tick();
   const sale=calls.find(c=>c.p_action==='checkout');assert(sale);assert.equal(sale.p_data.items[0].product_id,'p1');assert.equal(sale.p_data.discount,0);assert(w.document.querySelector('#sellerResult').textContent.includes('confirmada'));
   w.document.querySelector('[data-add]').click();w.document.querySelector('#sellerPayment').value='Crediário VIP';w.document.querySelector('#sellerPayment').dispatchEvent(new w.Event('change'));assert(!w.document.querySelector('#sellerVip').classList.contains('hidden'));
   w.document.querySelector('#sellerAddInstallment').click();assert.equal(w.document.querySelectorAll('.vip-row').length,1);
   assert(!calls.some(c=>c.p_action==='panel'));assert(!calls.some(c=>c.name==='operational_snapshot'));
 }else{assert.equal(w.document.querySelectorAll('[data-slot]').length,2);assert(!w.document.querySelector('#sellerPortal'));assert(w.document.querySelector('#accessPanel').textContent.includes('Disponível'));}
 await w.tdtAccess.lock();assert(w.document.body.classList.contains('auth-locked'));assert.equal(calls.at(-1).p_action,'lock');assert.deepEqual(errors,[]);
 dom.window.close();
}
(async()=>{await run('staff');await run('admin');console.log('PASS: distinct seller/admin interfaces, safe text, stock search/scanner, cart editing, sale payload, VIP rows, slots and lock.');})().catch(e=>{console.error(e);process.exitCode=1});
