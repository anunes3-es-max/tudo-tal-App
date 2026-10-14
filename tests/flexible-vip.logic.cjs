// UI/transport regression tests; monetary invariants and RLS use flexible-vip.sql.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
class Element{
  constructor(doc,id,tag='div'){this.doc=doc;this.id=id;this.tag=tag;this.children=[];this.value='';this.dataset={};this.disabled=false;this.textContent='';this.options=[];const classes=new Set();this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),toggle:(x,v)=>v?classes.add(x):classes.delete(x),contains:x=>classes.has(x)}}
  set innerHTML(html){for(const id of this.children)this.doc.remove(id);this.children=[];this.html=String(html);this.doc.parse(this.html,this)}
  get innerHTML(){return this.html||''}
  addEventListener(event,fn){this['on'+event]=fn}
  focus(){}
  showModal(){this.open=true}
  close(){this.open=false}
  querySelectorAll(selector){const tags=selector.split(',');return [...this.doc.ids.values()].filter(x=>tags.includes(x.tag)&&this.descends(x))}
  descends(el){let parent=el.parent;while(parent){if(parent===this)return true;parent=parent.parent}return false}
}
class Document{
  constructor(html){this.ids=new Map();this.parse(html,null)}
  remove(id){const e=this.ids.get(id);if(e)for(const child of e.children)this.remove(child);this.ids.delete(id)}
  parse(html,parent){
    for(const match of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){
      const [tagHtml,tag,id]=match;const el=new Element(this,id,tag);el.parent=parent;parent?.children.push(id);this.ids.set(id,el);
      el.value=decode(tagHtml.match(/\bvalue="([^"]*)"/)?.[1]||'');el.disabled=/\bdisabled(?:\s|>)/.test(tagHtml);
      if(tag==='select'){
        const inside=html.slice(match.index+tagHtml.length).split('</select>')[0];
        el.options=[...inside.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map(m=>({value:decode(m[1].match(/value="([^"]*)"/)?.[1]??m[2]),textContent:decode(m[2]),selected:m[1].includes('selected')}));
        el.value=(el.options.find(o=>o.selected)||el.options[0])?.value||'';
      }
    }
  }
  querySelector(selector){return this.ids.get(selector.replace(/^#/,''))||null}
  querySelectorAll(){return []}
  addEventListener(){}
}
function setup(){
  const document=new Document(read('index.html')),values=new Map(),toasts=[],rpcCalls=[];
  const product={id:'qa-product',sku:'QA-01',name:'Produto QA',category:'Cabelo',owner:'Tudo e Tal',price:500,qty:20,mode:'proprio',createdAt:new Date().toISOString()};
  const state={products:[product],sales:[],cash:[],saleCart:[{productId:product.id,qty:1}],saleDiscount:0,saleCheckout:{payment:'Crediário VIP'},view:'venda'};
  const transport={fail:false,receivables:[],payments:[],products:[{...product,owner_name:'Tudo e Tal'}],sales:[],cash:[]};
  const stores={products:[],sales:[],cash:[]};
  const client={
    async rpc(name,args){rpcCalls.push({name,args:JSON.parse(JSON.stringify(args))});if(transport.fail)throw new Error('Conexão interrompida');return {data:{total:500,discount_amount:0},error:null}},
    from(name){const q={select:()=>q,order:()=>q,then:(resolve,reject)=>Promise.resolve({data:name==='receivable_installments'?transport.receivables:name==='receivable_payments'?transport.payments:transport[name]||[],error:null}).then(resolve,reject)};return q}
  };
  const context={document,state,console:{error(){}},navigator:{onLine:true},URL,Date,Math,Map,Set,Number,Promise,crypto:require('node:crypto').webcrypto,
    localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},
    $:s=>document.querySelector(s),$$:s=>document.querySelectorAll(s),setTimeout:()=>0,clearTimeout(){},confirm:()=>true,
    esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])),
    money:v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),uid:()=>require('node:crypto').randomUUID(),toast:s=>toasts.push(s),nav(){},
    infinityCardFields:()=>'<input id="saleInstallments" value="2">',rememberInfinityPayChoice(){},
    tudoTalSupabase:client,async dbClear(n){stores[n]=[]},async localPut(n,o){stores[n].push(o)},async loadState(){for(const n of ['products','sales','cash'])state[n]=stores[n]},
    renderDashboard(){},renderProducts(){},renderLabelOptions(){},renderCash(){}
  };
  context.window=context;vm.createContext(context);
  const run=code=>vm.runInContext(code,context),load=file=>run(read(file));
  load('cloud-sync.js');load('vip-credit.js');load('pdv-cart-v23.js');
  context.renderSaleCart();
  return {context,state,document,transport,values,toasts,rpcCalls,run};
}
(async()=>{
  const env=setup(),c=env.context,s=env.state,d=env.document;
  const el=id=>d.ids.get(id);
  el('vipCustomerName').value='Cliente QA';el('vipCustomerPhone').value='(11) 99999-0101';el('vipDownPayment').value='100';c.vipChangeDownPayment();
  assert.equal(el('vipAmount-0').value,'200.00');assert.equal(el('vipAmount-1').value,'200.00');
  el('vipAmount-0').value='250';el('vipAmount-1').value='150';c.vipEditInstallment();
  let payload=c.vipCheckoutPayload();assert.equal(payload.plan.down_payment,100);assert.deepEqual(Array.from(payload.plan.installments,r=>r.amount),[250,150]);
  assert.equal((Date.parse(payload.plan.installments[1].due_date)-Date.parse(payload.plan.installments[0].due_date))/86400000,30);
  c.renderSaleCart();assert.equal(el('vipCustomerName').value,'Cliente QA');assert.equal(el('vipAmount-0').value,'250.00','Rerender lost custom amounts');
  assert.equal(JSON.parse(env.values.get('tdtSaleCart')).checkout.vip.customerName,'Cliente QA');
  c.setSaleDiscount(10);assert.throws(()=>c.vipCheckoutPayload(),/ultrapassa/);assert.equal(el('vipAmount-0').value,'250.00');
  c.setSaleDiscount(0);el('vipDue-0').value='';assert.throws(()=>c.vipCheckoutPayload(),/vencimentos/);
  el('vipDue-0').value=payload.plan.installments[0].due_date;
  el('vipAmount-0').value='150';el('vipAmount-1').value='250';c.vipEditInstallment();assert.deepEqual(Array.from(c.vipCheckoutPayload().plan.installments,r=>r.amount),[150,250]);
  el('vipAmount-0').value='250';el('vipAmount-1').value='150';c.vipEditInstallment();
  env.transport.fail=true;await c.confirmSale();assert.equal(env.rpcCalls.length,1);assert.equal(s.saleCart.length,1);assert(!el('finishCartSaleBtn').disabled);
  env.transport.fail=false;await c.confirmSale();assert.equal(env.rpcCalls[1].args.p_cart_id,env.rpcCalls[0].args.p_cart_id,'Retry changed sale identifier');
  assert.equal(env.rpcCalls[1].name,'register_vip_sale_cart');assert.deepEqual(env.rpcCalls[1].args.p_plan.installments.map(r=>r.amount),[250,150]);assert.equal(s.saleCart.length,0);

  // Installment generation, full deposit, and decimal prices.
  const even=setup(),e=even.context,ed=even.document.ids;
  ed.get('vipCustomerName').value='Cliente QA';ed.get('vipDownPayment').value='500';e.vipChangeDownPayment();assert.equal(e.vipCheckoutPayload().plan.installments.length,0);
  even.state.products[0].price=100;ed.get('vipDownPayment').value='0';e.vipChangeDownPayment();ed.get('vipSplitCount').value='3';e.vipSplitBalance();
  assert.deepEqual(Array.from(e.vipCheckoutPayload().plan.installments,r=>r.amount),[33.33,33.33,33.34]);
  even.state.products[0].price=33.33;even.state.saleCart[0].qty=3;assert.equal(Math.round(e.pdvTotals().final*100),9999);
  even.state.products[0].price=19.99;even.state.saleDiscount=15;assert.equal(e.pdvUnitPrice(even.state.products[0]),16.99);

  // Real dashboard code must count only paid VIP amounts as cash.
  const dash=read('app-1.js').match(/^function renderDashboard\(\).*$/m)[0];env.run(dash);
  s.sales=[{id:'sale',cartId:'cart',productName:'Produto QA',customerName:'Cliente QA',payment:'Crediário VIP',total:500,receivedAmount:100,date:new Date().toISOString(),qty:1,mode:'proprio'}];s.cash=[];
  c.renderDashboard();assert.match(el('dashboardCards').innerHTML,/Crediário a receber<\/span><strong>R\$\s*400,00/);assert.match(el('dashboardCards').innerHTML,/Saldo estimado<\/span><strong>R\$\s*100,00/);
  env.transport.receivables=[{id:'receipt-1',sale_id:'sale',cart_id:'cart',amount:250,paid_amount:50,status:'Pendente',installment_number:1,installment_count:2,due_date:'2099-01-01'}];
  env.transport.payments=[{id:'pay-1',receivable_id:'receipt-1',amount:50,payment_method:'Pix',received_at:new Date().toISOString()}];
  await c.renderFlexibleVipReceivables();assert.match(el('vipReceivableSummary').innerHTML,/200,00/);assert.match(el('vipReceivables').innerHTML,/Cliente QA/);assert.match(el('vipReceivables').innerHTML,/Histórico de recebimentos/);
  c.openVipReceipt('receipt-1');assert.equal(el('vipReceiptAmount').value,'200.00');assert(el('vipReceiptDialog').open);
  el('vipReceiptAmount').value='201';const before=env.rpcCalls.length;await c.submitVipReceipt({preventDefault(){}});assert.equal(env.rpcCalls.length,before);assert.match(el('vipReceiptError').textContent,/saldo/);
  el('vipReceiptAmount').value='75';env.transport.fail=true;await c.submitVipReceipt({preventDefault(){}});const failed=env.rpcCalls.at(-1);
  env.transport.fail=false;await c.submitVipReceipt({preventDefault(){}});const success=env.rpcCalls.at(-1);assert.equal(success.name,'record_vip_payment');assert.equal(success.args.p_amount,75);assert.equal(success.args.p_request_id,failed.args.p_request_id);assert(!el('vipReceiptDialog').open);
  console.log('PASS: 100/250/150 and reversed amounts; draft persistence; dates and totals validation; cent rounding; idempotent retries; actual cash balance; partial receipt flow and history.');
})().catch(error=>{console.error(error);process.exitCode=1});
