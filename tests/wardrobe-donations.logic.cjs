// Actual UI scripts exercised with an isolated DOM and mocked transport.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
class Element {
  constructor(doc,id='',classes=''){
    this.doc=doc;this.id=id;this.dataset={};this.value='';this.disabled=false;this.isConnected=true;this.html='';this.text='';
    const values=new Set(classes.split(/\s+/));
    this.classList={add:x=>values.add(x),remove:x=>values.delete(x),contains:x=>values.has(x),toggle:(x,force)=>{const next=force??!values.has(x);next?values.add(x):values.delete(x);return next}};
  }
  set innerHTML(value){this.html=String(value)}
  get innerHTML(){return this.html}
  set textContent(value){this.text=String(value)}
  get textContent(){return this.text}
  get offsetParent(){return this.classList.contains('hidden')?null:{}}
  addEventListener(name,fn){this['on'+name]=fn}
  setAttribute(name,value){this[name]=value}
  focus(){this.doc.activeElement=this}
  reset(){for(const id of ['interestName','interestPhone'])if(this.doc.ids.has(id))this.doc.ids.get(id).value=''}
  querySelectorAll(selector){return this.doc.parse(selector,this.html)}
}
class Document {
  constructor(html){
    this.ids=new Map();this.attributes=new Map();this.html=html;this.visibilityState='visible';
    for(const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)){
      const cls=match[0].match(/\bclass="([^"]*)"/);this.ids.set(match[1],new Element(this,match[1],cls?.[1]||''));
    }
  }
  addEventListener(){}
  querySelector(selector){
    if(selector.startsWith('#'))return this.ids.get(selector.slice(1))||null;
    return this.parse(selector,[...this.ids.values()].map(el=>el.html).join(''))[0]||null;
  }
  querySelectorAll(selector){
    if(selector==='.view')return [...this.ids.values()].filter(el=>el.id.startsWith('view-'));
    return this.parse(selector,this.html+' '+[...this.ids.values()].map(el=>el.html).join(''));
  }
  parse(selector,html){
    const match=selector.match(/^\[(data-[a-z-]+)(?:="([^"]+)")?\]$/);if(!match)return [];
    const [unused,attr,wanted]=match;
    const re=new RegExp('<[^>]*\\b'+attr+'(?:="([^"]*)")?[^>]*>','g'),out=[];
    for(const item of html.matchAll(re)){
      const value=item[1]||'';if(wanted!==undefined&&value!==wanted)continue;
      const key=attr+':'+value;let el=this.attributes.get(key);
      if(!el){
        el=new Element(this);el.dataset[attr.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
        if(attr==='data-interest-status'){
          const rest=html.slice(item.index+item[0].length).split('</select>')[0];
          el.value=rest.match(/<option value="([^"]+)"\s+selected/)?.[1]||'';
        }
        this.attributes.set(key,el);
      }
      out.push(el);
    }
    return out;
  }
}

function env(kind){
 const document=new Document(fs.readFileSync(path.join(root,kind,'index.html'),'utf8'));
 const context={document,console,setInterval:()=>1,setTimeout:()=>1,clearTimeout(){},location:{},Map,Set,Date,Math};
 context.window=context;vm.createContext(context);
 return {context,document,run:code=>vm.runInContext(code,context),load:name=>vm.runInContext(fs.readFileSync(path.join(root,kind,name),'utf8'),context)};
}
(async()=>{
 const u=env('store'),c=u.context,d=u.document;
 const rows=[
 {id:'beauty',name:'Creme',category:'Cabelo',catalog_section:'loja',size:'250 ml',price:50,available_qty:2},
 {id:'adult',name:'Vestido <M>',category:'Moda Adulto',catalog_section:'vestuario',age_group:'adulto',gender:'feminino',size:' M ',price:80,available_qty:1},
 {id:'male',name:'Camisa',category:'Moda Adulto',catalog_section:'vestuario',age_group:'adulto',gender:'masculino',size:'G',price:40,available_qty:1},
 {id:'child',name:'Camiseta infantil',category:'Moda Infantil',catalog_section:'vestuario',age_group:'infantil',gender:'unissex',size:'6',price:25,available_qty:0},
 {id:'gift',name:'Doação QA',category:'Moda Infantil',catalog_section:'vestuario',age_group:'infantil',gender:'unissex',size:'6',price:0,available_qty:1,is_donation:true}
 ];
 let calls=[],reservationError=null;
 c.supabase={createClient:()=>({rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='get_catalog_products_v2')return {data:rows};
  if(name==='get_catalog_config')return {data:{whatsapp_number:'11999990100',reservation_minutes:60}};
  if(name==='create_catalog_donation')return reservationError?{error:reservationError}:{data:{order_number:'QA-1',reservation_expires_at:'2026-10-17T18:00:00Z'}};
  throw Error(name);
 }})};
 u.load('catalogo.js');await c.init();
 assert.match(d.ids.get('catalogGrid').html,/Creme/);assert.doesNotMatch(d.ids.get('catalogGrid').html,/Vestido|Doação QA/);
 c.selectCatalogSection('vestuario');assert.match(d.ids.get('catalogGrid').html,/Vestido &lt;M&gt;/);assert.doesNotMatch(d.ids.get('catalogGrid').html,/Creme|Doação QA/);
 d.ids.get('ageFilter').onchange({target:{value:'adulto'}});d.ids.get('genderFilter').onchange({target:{value:'feminino'}});d.ids.get('sizeFilter').onchange({target:{value:'M'}});
 assert.equal(u.run('filteredProducts().length'),1);assert.equal(u.run('filteredProducts()[0].id'),'adult');
 c.clearClothingFilters();d.ids.get('ageFilter').onchange({target:{value:'infantil'}});
 assert.equal(u.run('filteredProducts()[0].id'),'child');assert.match(d.ids.get('catalogGrid').html,/Quero ser avisado/);
 c.selectClothingOffer('donation');assert.match(d.ids.get('catalogGrid').html,/Grátis/);assert.match(d.ids.get('catalogGrid').html,/data-donate="gift"/);assert.doesNotMatch(d.ids.get('catalogGrid').html,/data-add|data-interest/);
 assert.doesNotMatch(d.ids.get('sizeFilter').html,/250 ML/);
 c.addToCart('beauty');c.openDonation('gift');d.ids.get('donationName').value='Cliente QA';d.ids.get('donationPhone').value='123';
 await c.submitDonation({preventDefault(){}});assert.match(d.ids.get('donationError').text,/WhatsApp válido/);assert.equal(calls.filter(x=>x.name==='create_catalog_donation').length,0);
 d.ids.get('donationPhone').value='(11) 99999-0101';await c.submitDonation({preventDefault(){}});
 const sent=calls.find(x=>x.name==='create_catalog_donation');assert.equal(sent.args.p_customer_phone,'5511999990101');assert.equal(sent.args.p_product_id,'gift');
 assert(d.ids.get('donationModal').classList.contains('hidden'));assert.match(d.ids.get('successText').text,/Retirada grátis/);assert.equal(u.run('S.cart.size'),1,'A doação apagou a sacola de compras');
 assert.match(decodeURIComponent(d.ids.get('whatsappLink').href),/Retirada gratuita/);
 c.openDonation('gift');d.ids.get('donationName').value='Cliente QA';d.ids.get('donationPhone').value='11999990102';reservationError={code:'P0001',message:'Estoque insuficiente.'};
 await c.submitDonation({preventDefault(){}});assert.match(d.ids.get('donationError').text,/Estoque insuficiente/);assert(!d.ids.get('reserveDonationButton').disabled);
 rows[4].available_qty=0;await c.loadProducts();assert.match(d.ids.get('catalogGrid').html,/Indisponível/);assert.doesNotMatch(d.ids.get('catalogGrid').html,/data-donate|data-interest/);
 console.log('PASS: section isolation; combined age/gender/size filters; free pickup form; validation; error recovery; shopping cart preserved; unavailable donation.');

 const a=env('admin'),ac=a.context,ad=a.document;
 const product={id:'product',sku:'TDT-1',name:'Creme QA',category:'Cabelo',catalogSection:'loja',price:100,qty:2,mode:'proprio',owner:'QA',photo:'catalog-photo.jpg'};
 let saved=[],release;
 Object.assign(ac,{state:{products:[product]},$:s=>ad.querySelector(s),esc:v=>String(v??''),money:v=>'R$ '+v,nav(){},nowISO:()=>new Date().toISOString(),uid:()=> 'new-product',nextSku:()=> 'NEW-SKU',MULTI_CATEGORIES:new Set(['Cabelo']),toast(){},loadState:async()=>{},tudoTalCloud:{saveProductAdmin:async p=>{saved.push(p);if(release)await release}}});
 a.load('app-2.js');ac.editProduct('product');assert.equal(ad.ids.get('saveProductButton').textContent,'Atualizar produto');
 ad.ids.get('productQty').value='0';product.qty=1; // A background sync must not replace the quantity seen by the editor.
 await ac.saveProduct({preventDefault(){}});assert.equal(saved[0].qty,0);assert.equal(saved[0].expectedQty,2);assert.equal(saved[0].photo,'catalog-photo.jpg');
 assert.match(ad.html,/id="productQty"[^>]*min="0"/);
 product.qty=2;ac.editProduct('product');ad.ids.get('productCatalogSection').value='vestuario';ad.ids.get('productOffer').value='donation';
 ad.ids.get('productAgeGroup').value='infantil';ad.ids.get('productGender').value='unissex';ad.ids.get('productSize').value='6';ac.syncProductCatalogFields();
 assert.equal(Number(ad.ids.get('productPrice').value),0);assert.equal(ad.ids.get('productMode').value,'proprio');assert(ad.ids.get('productMode').disabled);
 await ac.saveProduct({preventDefault(){}});assert.equal(saved[1].isDonation,true);assert.equal(saved[1].price,0);assert.equal(saved[1].ageGroup,'infantil');
 ad.ids.get('productOffer').value='sale';ac.syncProductCatalogFields();assert.equal(ad.ids.get('productPrice').readOnly,false);assert.equal(ad.ids.get('productPrice').value,'');
 console.log('PASS: explicit update button; stock zero; original quantity snapshot; photo preservation; donation metadata and zero-price controls.');
 const adminOrder={id:'gift-order',order_number:'QA-GIFT',order_type:'donation',customer_name:'Cliente QA',customer_phone:'11999990101',status:'Novo',fulfillment:'Retirada na loja',subtotal:0,reservation_expires_at:'2026-10-17T18:00:00Z',catalog_order_items:[{product_name:'Peça QA',qty:1,total:0}]};
 const orderCalls=[];
 ac.confirm=()=>true;
 ad.ids.set('orderFinalizeModal',new Element(ad,'orderFinalizeModal','hidden'));
 ac.tudoTalSupabase={rpc:async(name,args)=>{orderCalls.push({name,args});return {data:[]}},from:()=>({select:()=>({order:()=>({limit:async()=>({data:[adminOrder]})})})})};
 ac.tudoTalCloud.syncAndRefresh=async()=>{};
 a.load('catalog-admin.js');await ac.renderCatalogOrders();
 assert.match(ad.ids.get('catalogOrdersList').html,/Confirmar retirada grátis/);
 assert.doesNotMatch(ad.ids.get('catalogOrdersList').html,/Registrar venda|value="Pago"|value="Aguardando pagamento"/);
 ad.ids.get('catalogOrdersList').querySelectorAll('[data-finalize]')[0].onclick();
 await new Promise(resolve=>setImmediate(resolve));
 assert(orderCalls.some(x=>x.name==='complete_catalog_donation'&&x.args.p_order_id==='gift-order'));
 assert(!orderCalls.some(x=>x.name==='confirm_catalog_order'));
 console.log('PASS: donation order shows pickup controls and completes through the free-pickup operation.');

})().catch(err=>{console.error(err);process.exitCode=1});
