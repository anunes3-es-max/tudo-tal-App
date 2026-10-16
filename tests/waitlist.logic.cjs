// Exercises the actual UI scripts with an isolated DOM adapter and mocked transport.
// Database permissions and stock rules are tested separately in waitlist.sql.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const browserTest=fs.readFileSync(path.join(__dirname,'waitlist.browser.cjs'),'utf8');
const fixtures=browserTest.slice(browserTest.indexOf('const fixture='),browserTest.indexOf('async function noOverflow'));
const sdk=vm.runInNewContext(fixtures+';sdk',{JSON});
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
function environment(kind){
  const document=new Document(fs.readFileSync(path.join(root,kind,'index.html'),'utf8'));
  const context={document,console:{error(){}},setInterval:()=>1,setTimeout:()=>1,clearTimeout(){},location:{},scrollTo(){},addEventListener(){},URL,Map,Set,Date,Math};
  context.window=context;vm.createContext(context);vm.runInContext(sdk,context);
  return {context,document,run:code=>vm.runInContext(code,context),load:name=>vm.runInContext(fs.readFileSync(path.join(root,kind,name),'utf8'),context)};
}
(async()=>{
  const publicUi=environment('store'),p=publicUi.context,d=publicUi.document;
  publicUi.load('product-groups.js');publicUi.load('catalogo.js');await p.init();
  assert.match(d.ids.get('catalogGrid').html,/Esgotado/);
  assert.match(d.ids.get('catalogGrid').html,/data-interest="qa-zero"/);
  assert.doesNotMatch(d.ids.get('catalogGrid').html,/data-add="qa-zero"/);
  const button=d.ids.get('catalogGrid').querySelectorAll('[data-interest]')[0];button.onclick();
  assert(!d.ids.get('interestModal').classList.contains('hidden'));
  d.ids.get('interestName').value='Cliente teste';d.ids.get('interestPhone').value='123';
  await p.submitInterest({preventDefault(){}});
  assert.match(d.ids.get('interestError').text,/WhatsApp válido/);assert.equal(p.__qaContacts.length,0);
  d.ids.get('interestPhone').value='(11) 99999-0101';await p.submitInterest({preventDefault(){}});
  assert.equal(p.__qaContacts[0].p_product_id,'qa-zero');assert.equal(p.__qaContacts[0].p_customer_phone,'5511999990101');
  assert(!d.ids.get('interestSuccess').classList.contains('hidden'));
  p.closeInterest();p.openInterest('qa-zero',button);
  d.ids.get('interestName').value='Nome diferente';d.ids.get('interestPhone').value='+55 (11) 99999-0101';
  await p.submitInterest({preventDefault(){}});assert.equal(p.__qaContacts.length,1);
  p.closeInterest();p.__qaProducts[0].available_qty=2;await p.loadProducts();
  assert.match(d.ids.get('catalogGrid').html,/data-add="qa-zero"/);assert.doesNotMatch(d.ids.get('catalogGrid').html,/data-interest="qa-zero"/);
  p.addToCart('qa-zero');assert.equal(d.ids.get('cartCount').text,'1');
  p.__qaProducts[0].available_qty=0;await p.loadProducts();assert.equal(d.ids.get('cartCount').text,'0');assert.equal(publicUi.run('S.cart.size'),0);
  p.openInterest('qa-zero',button);p.__qaProducts[0].available_qty=2;
  d.ids.get('interestName').value='Cliente teste';d.ids.get('interestPhone').value='11999990102';
  await p.submitInterest({preventDefault(){}});assert.match(d.ids.get('interestError').text,/não está esgotado/);assert.equal(p.__qaContacts.length,1);
  p.interestKeyboard({key:'Escape',preventDefault(){}});assert(d.ids.get('interestModal').classList.contains('hidden'));
  console.log('PASS: public UI script, sold-out action, phone validation, normalized contact, confirmation, duplicate response, restock and removal of sold-out cart entries.');

  const adminUi=environment('admin'),a=adminUi.context,ad=adminUi.document;
  a.tudoTalSupabase=a.__qaClient;adminUi.load('app-1.js');adminUi.load('waitlist-admin.js');await a.initWaitlist();
  assert.match(ad.ids.get('waitlistSummary').html,/>3<\/strong>/);
  assert.match(ad.ids.get('waitlistList').html,/&lt;b&gt;Cliente teste&lt;\/b&gt;/);
  assert.doesNotMatch(ad.ids.get('waitlistList').html,/<b>Cliente teste<\/b>/);
  assert(ad.ids.get('waitlistList').html.indexOf('Medicube Zero Pore Pad')<ad.ids.get('waitlistList').html.indexOf('Dr. Althea 345 Cream'));
  ad.ids.get('waitlistFilters').querySelectorAll('[data-waitlist-filter]').find(el=>el.dataset.waitlistFilter==='Prontos para avisar').onclick();
  assert.match(ad.ids.get('waitlistList').html,/Bia teste/);assert.doesNotMatch(ad.ids.get('waitlistList').html,/Ana teste/);
  assert.match(ad.ids.get('waitlistList').html,/https:\/\/wa.me\/5511999990103\?text=/);
  const id='33333333-3333-4333-8333-333333333333';
  ad.querySelector('[data-interest-status="'+id+'"]').value='Avisado';
  await ad.ids.get('waitlistList').querySelectorAll('[data-save-interest]')[0].onclick();
  assert.equal(a.__qaInterests.find(row=>row.id===id).status,'Avisado');
  ad.ids.get('waitlistFilters').querySelectorAll('[data-waitlist-filter]').find(el=>el.dataset.waitlistFilter==='Avisados').onclick();
  assert.match(ad.ids.get('waitlistList').html,/Avisado em/);
  ad.ids.get('waitlistSearch').oninput({target:{value:'(11) 99999-0102'}});
  assert.match(ad.ids.get('waitlistList').html,/Cliente teste/);assert.doesNotMatch(ad.ids.get('waitlistList').html,/Bia teste/);
  ad.ids.get('waitlistSearch').oninput({target:{value:''}});a.__qaProducts[0].available_qty=2;await a.renderWaitlist();
  ad.ids.get('waitlistFilters').querySelectorAll('[data-waitlist-filter]').find(el=>el.dataset.waitlistFilter==='Prontos para avisar').onclick();
  assert.match(ad.ids.get('waitlistList').html,/Ana teste/);assert.match(ad.ids.get('waitlistList').html,/Já pode avisar/);
  a.nav('espera');await a.renderWaitlist();assert(ad.ids.get('view-espera').classList.contains('active'));
  console.log('PASS: admin UI script, demand order, filtered contacts, escaped names, WhatsApp draft links, saved status, search, restock highlights and stock navigation.');
})().catch(error=>{console.error(error);process.exitCode=1});
