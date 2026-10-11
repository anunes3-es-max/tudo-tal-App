// UI tests use local fixtures only; no customer data or messages are sent.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const screenshots=path.join(root,'qa-checks');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  let file=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){res.writeHead(404);res.end();return}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/plain'});res.end(fs.readFileSync(file));
});
const fixture=[
  {id:'qa-zero',sku:'TDT-QA-0001',name:'Medicube Zero Pore Pad',category:'Skincare',brand:'Medicube',size:'70 pads',condition:'Novo',price:150,original_price:150,available_qty:0,photo_url:'assets/icon.svg',active:true},
  {id:'qa-stock',sku:'TDT-QA-0002',name:'Dr. Althea 345 Cream',category:'Skincare',brand:'Dr. Althea',size:'50 ml',condition:'Novo',price:140,original_price:140,available_qty:2,photo_url:'assets/icon.svg',active:true}
];
const sdk=`
window.__qaProducts=${JSON.stringify(fixture)};
window.__qaContacts=[];window.__qaCalls=[];
window.__qaInterests=[
  {id:'11111111-1111-4111-8111-111111111111',product_id:'qa-zero',customer_name:'Ana teste',customer_phone:'5511999990101',status:'Aguardando reposição',created_at:'2026-10-11T12:00:00Z'},
  {id:'22222222-2222-4222-8222-222222222222',product_id:'qa-zero',customer_name:'<b>Cliente teste</b>',customer_phone:'5511999990102',status:'Avisado',created_at:'2026-10-11T13:00:00Z'},
  {id:'33333333-3333-4333-8333-333333333333',product_id:'qa-stock',customer_name:'Bia teste',customer_phone:'5511999990103',status:'Aguardando reposição',created_at:'2026-10-11T14:00:00Z'},
  {id:'44444444-4444-4444-8444-444444444444',product_id:'qa-stock',customer_name:'Cris teste',customer_phone:'5511999990104',status:'Atendido',created_at:'2026-10-11T15:00:00Z'}
];
window.__qaClient={
  rpc:async(name,params)=>{
    window.__qaCalls.push({name,params});
    if(name==='get_catalog_products')return {data:JSON.parse(JSON.stringify(window.__qaProducts)),error:null};
    if(name==='get_catalog_config')return {data:{store_name:'Tudo & Tal',reservation_minutes:60,whatsapp_number:'5511999990999'},error:null};
    if(name==='create_catalog_interest'){
      const p=window.__qaProducts.find(x=>x.id===params.p_product_id);
      if(!p||p.available_qty>0)return {error:{code:'22023',message:'Este produto não está esgotado. Atualize o catálogo para conferir a disponibilidade.'}};
      if(!window.__qaContacts.some(x=>x.p_product_id===params.p_product_id&&x.p_customer_phone===params.p_customer_phone))window.__qaContacts.push(params);
      return {data:{status:'received'},error:null};
    }
    if(name==='update_catalog_interest_status'){
      const row=window.__qaInterests.find(x=>x.id===params.p_interest_id);row.status=params.p_status;
      row.notified_at=params.p_status==='Avisado'?'2026-10-11T19:00:00Z':row.notified_at;
      return {data:{id:row.id,status:row.status},error:null};
    }
    return {data:null,error:null};
  },
  from:table=>{
    let offset=0,end=499;
    const builder={select:()=>builder,order:()=>builder,eq:()=>builder,limit:()=>builder,
      range:(a,b)=>{offset=a;end=b;return builder},
      maybeSingle:async()=>({data:{store_name:'Tudo & Tal',reservation_minutes:60,whatsapp_number:'5511999990999'},error:null}),
      then:(resolve,reject)=>Promise.resolve({data:table==='catalog_waitlist'?window.__qaInterests.slice(offset,end+1).map(row=>({...row,products:window.__qaProducts.find(x=>x.id===row.product_id)})):[],error:null}).then(resolve,reject)};
    return builder;
  },
  channel:()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel}
};
window.supabase={createClient:()=>window.__qaClient};
`;
async function noOverflow(page){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow')}
async function catalogTest(browser,base){
  const context=await browser.newContext({viewport:{width:375,height:812},serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:sdk}));
  await page.goto(base+'/store/');
  const sold=page.locator('.product-card').filter({hasText:'Medicube Zero Pore Pad'});
  await sold.getByText('Esgotado',{exact:true}).waitFor();
  assert.equal(await sold.locator('[data-add]').count(),0);
  await sold.locator('[data-interest]').click();
  await page.locator('#interestName').fill('Cliente teste');
  await page.locator('#interestPhone').fill('123');
  await page.locator('#registerInterestButton').click();
  await page.locator('#interestError').getByText('Informe um WhatsApp válido com DDD.').waitFor();
  assert.equal(await page.evaluate(()=>__qaContacts.length),0);
  await noOverflow(page);
  await page.screenshot({path:path.join(screenshots,'catalog-mobile.png'),fullPage:true});
  await page.locator('#interestPhone').fill('(11) 99999-0101');
  await page.locator('#registerInterestButton').click();
  await page.getByRole('heading',{name:'Você está na lista!'}).waitFor();
  assert.equal(await page.evaluate(()=>__qaContacts[0].p_customer_phone),'5511999990101');
  await page.locator('#backFromInterest').click();
  await sold.locator('[data-interest]').click();
  await page.locator('#interestName').fill('Outro nome');
  await page.locator('#interestPhone').fill('+55 11 99999-0101');
  await page.locator('#registerInterestButton').click();
  await page.getByRole('heading',{name:'Você está na lista!'}).waitFor();
  assert.equal(await page.evaluate(()=>__qaContacts.length),1);
  await page.locator('#backFromInterest').click();
  await page.evaluate(async()=>{__qaProducts[0].available_qty=2;await loadProducts()});
  assert.equal(await sold.locator('[data-interest]').count(),0);
  await sold.locator('[data-add]').click();
  assert.equal(await page.locator('#cartCount').innerText(),'1');
  await page.evaluate(async()=>{__qaProducts[0].available_qty=0;await loadProducts()});
  assert.equal(await page.locator('#cartCount').innerText(),'0');
  await sold.locator('[data-interest]').click();
  await page.locator('#interestName').fill('Cliente teste');
  await page.locator('#interestPhone').fill('11999990102');
  await page.evaluate(()=>{__qaProducts[0].available_qty=2});
  await page.locator('#registerInterestButton').click();
  await page.locator('#interestError').getByText(/não está esgotado/).waitFor();
  assert.equal(await page.evaluate(()=>__qaContacts.length),1);
  await page.keyboard.press('Escape');
  assert(await page.locator('#interestModal').evaluate(el=>el.classList.contains('hidden')));
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(async()=>{__qaProducts[0].available_qty=0;await loadProducts()});
  await noOverflow(page);
  await page.screenshot({path:path.join(screenshots,'catalog-desktop.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await context.close();
  console.log('PASS: catalog mobile/desktop, sold-out card, form, duplicate response, restock, stale availability and bag cleanup.');
}
async function adminTest(browser,base){
  const context=await browser.newContext({viewport:{width:375,height:812},serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:sdk}));
  await page.route('**/auth-setup.js?*',route=>route.fulfill({contentType:'text/javascript',body:`window.requireInitialAdminAuth=async()=>{window.tudoTalSupabase=window.__qaClient;document.body.classList.remove('auth-locked');document.querySelector('#authGate').classList.add('hidden');return true};`}));
  await page.route('**/cloud-sync.js?*',route=>route.fulfill({contentType:'text/javascript',body:'window.tudoTalCloud={syncAll:async()=>true,syncAndRefresh:async()=>true};'}));
  await page.goto(base+'/admin/');
  await page.locator('.quick[data-nav="espera"]').click();
  await page.locator('#view-espera.active .waitlist-product').first().waitFor();
  assert.equal(await page.locator('#waitlistSummary .order-kpi strong').allTextContents().then(x=>x.join(',')),'3,2,1,1');
  assert.equal(await page.locator('.waitlist-customer').count(),3);
  assert.equal(await page.locator('.waitlist-customer-info strong b').count(),0);
  assert.equal(await page.locator('.waitlist-product h2').first().innerText(),'Medicube Zero Pore Pad');
  await noOverflow(page);
  await page.screenshot({path:path.join(screenshots,'waitlist-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Prontos para avisar',exact:true}).click();
  assert.equal(await page.locator('.waitlist-customer').count(),1);
  const link=await page.locator('.waitlist-customer a').getAttribute('href');
  assert(link.startsWith('https://wa.me/5511999990103?text='));
  assert(decodeURIComponent(link).includes('Dr. Althea 345 Cream voltou ao estoque'));
  await page.locator('[data-interest-status]').selectOption('Avisado');
  await page.locator('[data-save-interest]').click();
  await page.waitForFunction(()=>__qaInterests.find(x=>x.customer_name==='Bia teste').status==='Avisado');
  await page.getByRole('button',{name:'Avisados',exact:true}).click();
  const bia=page.locator('.waitlist-customer').filter({hasText:'Bia teste'});
  await bia.getByText('Avisado em',{exact:false}).waitFor();
  await bia.locator('[data-interest-status]').selectOption('Atendido');
  await bia.locator('[data-save-interest]').click();
  await page.waitForFunction(()=>__qaInterests.find(x=>x.customer_name==='Bia teste').status==='Atendido');
  await page.getByRole('button',{name:'Todos',exact:true}).click();
  await page.locator('#waitlistSearch').fill('(11) 99999-0101');
  assert.equal(await page.locator('.waitlist-customer').count(),1);
  await page.locator('#waitlistSearch').fill('');
  await page.evaluate(async()=>{__qaProducts[0].available_qty=1;await renderWaitlist()});
  await page.getByRole('button',{name:'Prontos para avisar',exact:true}).click();
  assert.equal(await page.locator('.waitlist-customer').count(),1);
  assert.equal(await page.locator('.waitlist-customer-info strong').innerText(),'Ana teste');
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'Pendentes',exact:true}).click();
  await noOverflow(page);
  await page.screenshot({path:path.join(screenshots,'waitlist-desktop.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await context.close();
  console.log('PASS: admin entry, badges, demand order, filters, safe customer rendering, WhatsApp draft links, status changes and restock highlight.');
}
(async()=>{
  fs.mkdirSync(screenshots,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),args:['--no-sandbox']});
  try{const base='http://127.0.0.1:'+server.address().port;await catalogTest(browser,base);await adminTest(browser,base)}
  finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1;server.close()});
