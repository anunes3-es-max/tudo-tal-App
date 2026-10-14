const CACHE='tudo-tal-v36';
const APP=['./','./index.html','./styles.css?v=16','./vip-credit.css?v=1','./vip-credit.js?v=1','./qr-v1.js?v=2','./app-1.js?v=15','./cloud-sync.js?v=15','./app-2.js?v=4','./app-3.js?v=14','./pdv-cart-v23.js?v=2','./labels-v17.js?v=5','./app-4.js?v=10','./catalog-admin.js?v=2','./waitlist-admin.js?v=1','./analytics.js?v=4','./auth-setup.js?v=9','./app-5.js?v=12','./catalogo.html','./catalogo.css?v=4','./catalogo.js?v=3','./manifest.webmanifest','./assets/logo.svg','./assets/icon.svg'];
const APP_URLS=new Set(APP.map(path=>new URL(path,self.location.href).href));

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(APP)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tudo-tal-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  // Respostas do Supabase incluem fotos, estoque e dados da sessão.
  // Somente os arquivos estáticos do aplicativo podem entrar neste cache.
  if(url.origin!==self.location.origin)return;
  if(e.request.mode==='navigate'){
    const fallback=url.pathname.endsWith('/catalogo.html')?'./catalogo.html':'./index.html';
    e.respondWith(
      fetch(e.request).then(async resp=>{
        if(resp.ok){
          const c=await caches.open(CACHE);
          await c.put(fallback,resp.clone()).catch(()=>{});
        }
        return resp;
      }).catch(()=>caches.open(CACHE).then(c=>c.match(fallback)))
    );
    return;
  }
  if(!APP_URLS.has(url.href))return;
  e.respondWith(
    caches.open(CACHE).then(c=>c.match(e.request).then(r=>r||fetch(e.request).then(async resp=>{
      if(resp.ok)await c.put(e.request,resp.clone()).catch(()=>{});
      return resp;
    })))
  );
});

