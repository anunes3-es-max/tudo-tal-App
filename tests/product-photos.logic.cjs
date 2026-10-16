// Run with: node tests/product-photos.logic.cjs
// Uses the actual worker, sync and product UI scripts with isolated transports.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const origin='https://anunes3-es-max.github.io';
const base=origin+'/tudo-tal-App/';
const api='https://iugryzipeqbgoplwqdqn.supabase.co/rest/v1/products?select=*';
const source=name=>fs.readFileSync(path.join(root,name),'utf8');
const products=[
  ['karseell','Karseell Tratamento Capilar Com Óleo De Argan Marrocos','50 ML'],
  ['victoria','Hidratante Victoria\'s Secret','236 ML'],
  ['tsubaki','Mascara Tsubaki premium EX','180 g'],
  ['lattafa','Lattafa Teriaq Perfume Mist - Body Splash','250 ML'],
  ['joico','Kit Joico Moisture Recovery Shampoo, Condicionador e Máscara','1L'],
  ['fino','Máscara capilar Fino','230g']
].map(([id,name,size],i)=>({id,sku:'TDT-CAB-'+String(i+1).padStart(4,'0'),name,size,
  category:'Cabelo',mode:'proprio',owner_name:'Tudo e Tal',price:100,qty:2,cost:0,
  photo_url:base+'photos/'+id+'-catalog.jpg',active:true,
  created_at:'2026-10-10T10:00:00Z',updated_at:'2026-10-11T20:15:00Z'}));

function workerEnvironment(){
  const events=new Map(),stores=new Map(),calls=[];
  let networkProducts=products,offline=false,claimed=false,skipped=false;
  const key=request=>new URL(typeof request==='string'?request:request.url,base).href;
  const getStore=name=>{
    if(!stores.has(name))stores.set(name,new Map());
    const entries=stores.get(name);
    return {
      async match(request){return entries.get(key(request))?.clone()},
      async put(request,response){entries.set(key(request),response.clone())},
      async addAll(requests){for(const request of requests)entries.set(key(request),new Response('static '+key(request)))}
    };
  };
  const network=async request=>{
    const url=key(request);calls.push(url);
    if(offline)throw new Error('offline');
    if(url===api)return Response.json(networkProducts);
    return new Response('network '+url,{status:request.testStatus||200});
  };
  const caches={
    async open(name){return getStore(name)},
    async keys(){return [...stores.keys()]},
    async delete(name){return stores.delete(name)},
    async match(request){for(const name of stores.keys()){const found=await getStore(name).match(request);if(found)return found}}
  };
  const context={URL,Set,Promise,caches,fetch:network,self:{
    location:new URL(base+'sw.js'),
    addEventListener:(name,fn)=>events.set(name,fn),
    skipWaiting:async()=>{skipped=true},clients:{claim:async()=>{claimed=true}}
  }};
  vm.createContext(context);
  vm.runInContext(process.env.TDT_WORKER_SOURCE?fs.readFileSync(process.env.TDT_WORKER_SOURCE,'utf8'):source('sw.js'),context);
  const cacheName=vm.runInContext('CACHE',context);
  return {
    context,caches,stores,calls,cacheName,
    setProducts:rows=>{networkProducts=rows},setOffline:value=>{offline=value},
    get claimed(){return claimed},get skipped(){return skipped},
    async request(url,options={}){
      const request={url,method:'GET',mode:'cors',...options};let response;
      events.get('fetch')({request,respondWith:value=>{response=value}});
      return response===undefined?network(request):await response;
    },
    async lifecycle(name){let task;events.get(name)({waitUntil:value=>{task=value}});await task}
  };
}

async function checkWorker(){
  const worker=workerEnvironment();
  // Even if an old database response exists, both reads must reach the server.
  const stale=products.map(p=>({...p,photo_url:base+'photos/wrong.jpg'}));
  await (await worker.caches.open(worker.cacheName)).put(api,Response.json(stale));
  const first=await (await worker.request(api)).json();
  assert.equal(first[0].photo_url,products[0].photo_url,'Database responses must bypass the service worker cache');
  const changed=products.map(p=>({...p,photo_url:p.photo_url.replace('-catalog','-new')}));
  worker.setProducts(changed);
  const second=await (await worker.request(api)).json();
  assert.equal(second[0].photo_url,changed[0].photo_url,'A later photo change must be visible immediately');
  assert.equal(worker.calls.filter(url=>url===api).length,2);

  // Auth, sales, waitlists, and future same-origin APIs must also bypass cache.
  for(const url of [api.replace('products','sales'),api.replace('products','catalog_waitlist'),
    'https://iugryzipeqbgoplwqdqn.supabase.co/auth/v1/user',base+'api/products']){
    await (await worker.caches.open(worker.cacheName)).put(url,new Response('stale'));
    assert.equal(await (await worker.request(url)).text(),'network '+url);
  }
  await (await worker.caches.open('tudo-tal-v34')).put(api,Response.json(stale));
  await worker.caches.open('another-app-v1');
  worker.stores.delete(worker.cacheName); // Install a fresh worker cache.
  await worker.lifecycle('install');
  assert(worker.skipped);
  await worker.lifecycle('activate');
  assert(worker.claimed);
  assert(!worker.stores.has('tudo-tal-v34'));
  assert(worker.stores.has('another-app-v1'));
  assert([...worker.stores.get(worker.cacheName).keys()].every(url=>url.startsWith(base)));

  // Static files and the last successful HTML still work offline.
  const style=base+source('sw.js').match(/styles\.css\?v=\d+/)[0];worker.setOffline(true);
  assert.match(await (await worker.request(style)).text(),/^static /);
  await assert.rejects(worker.request(api),/offline/);
  const fallback=await (await worker.request(base+'?v=35',{mode:'navigate'})).text();
  assert.match(fallback,/index.html/);
  const catalogFallback=await (await worker.request(base+'catalogo.html',{mode:'navigate'})).text();
  assert.match(catalogFallback,/catalogo.html/);
  worker.setOffline(false);
  const fresh=await (await worker.request(base+'?v=35',{mode:'navigate'})).text();
  assert.equal(fresh,'network '+base+'?v=35');
  const error=await worker.request(base+'?v=bad',{mode:'navigate',testStatus:503});
  assert.equal(error.status,503);
  worker.setOffline(true);
  assert.equal(await (await worker.request(base,{mode:'navigate'})).text(),fresh,'A server error must not replace the offline page');
  worker.setOffline(false);
  worker.stores.get(worker.cacheName).delete(style);
  assert.equal((await worker.request(style,{testStatus:404})).status,404);
  assert(!worker.stores.get(worker.cacheName).has(style),'Failed assets must not be cached');
  assert.equal(await (await worker.request(base+'index.html',{method:'POST'})).text(),'network '+base+'index.html');
  return worker;
}

async function checkPanel(worker){
  worker.setProducts(products);
  const local={products:products.map(p=>({id:p.id,name:p.name,photo:base+'photos/wrong.jpg'})),sales:[],cash:[]};
  const elements=new Map(['cloudStatus','productSearch','productList'].map(id=>[id,{value:'',innerHTML:'',dataset:{}}]));
  const document={querySelector:selector=>elements.get(selector.slice(1)),addEventListener(){}};
  const context={document,console,navigator:{onLine:true},Date,Map,URL,
    state:{products:local.products,sales:[],cash:[]},
    $:selector=>document.querySelector(selector),
    esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])),
    money:value=>'R$ '+value,
    async dbClear(name){local[name]=[]},async localPut(name,row){local[name].push(row)},
    async loadState(){context.state.products=local.products},
    renderDashboard(){},renderLabelOptions(){},renderCash(){},
    tudoTalSupabase:{from:name=>({select:async()=>({data:name==='products'?await (await worker.request(api)).json():[],error:null})})}
  };
  context.window=context;vm.createContext(context);
  vm.runInContext(source('product-groups.js'),context);
  vm.runInContext(source('app-2.js'),context);
  vm.runInContext(source('cloud-sync.js'),context);
  assert(await context.tudoTalCloud.syncAndRefresh());
  for(const p of products){
    assert.equal(local.products.find(row=>row.id===p.id).photo,p.photo_url,p.name);
    assert(elements.get('productList').innerHTML.includes('src="'+p.photo_url+'"'),p.name+' must render the catalog photo');
  }
  assert(!elements.get('productList').innerHTML.includes('wrong.jpg'));

  // Updating the installed worker immediately refreshes the currently open panel.
  let changed,registered,refreshes=0;
  context.navigator.serviceWorker={
    addEventListener:(event,fn)=>{if(event==='controllerchange')changed=fn},
    register:async(url,options)=>{registered={url,options}}
  };
  context.location={protocol:'https:'};
  context.tudoTalCloud.syncAndRefresh=async()=>{refreshes++};
  vm.runInContext(source('app-5.js'),context);
  context.setupServiceWorker();
  assert.equal(registered.url,'./sw.js');assert.equal(registered.options.updateViaCache,'none');
  await changed();assert.equal(refreshes,1);
}

(async()=>{
  const worker=await checkWorker();
  await checkPanel(worker);
  console.log('PASS: live data bypasses cache; old cache removed; offline assets preserved; all six panel photos match the catalog; worker update refreshes the panel.');
})().catch(error=>{console.error(error);process.exitCode=1});
