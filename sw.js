const CACHE='tudo-tal-v24';
const APP=['./','./index.html','./styles.css?v=15','./qr-v1.js?v=2','./app-1.js?v=12','./cloud-sync.js?v=7','./app-2.js?v=3','./app-3.js?v=14','./pdv-cart-v23.js?v=1','./labels-v17.js?v=5','./app-4.js?v=8','./catalog-admin.js?v=2','./analytics.js?v=3','./auth-setup.js?v=4','./app-5.js?v=10','./catalogo.html','./catalogo.css?v=3','./catalogo.js?v=2','./manifest.webmanifest','./assets/logo.svg','./assets/icon.svg'];

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(APP)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  if(e.request.mode==='navigate'){
    const url=new URL(e.request.url);
    const fallback=url.pathname.endsWith('/catalogo.html')?'./catalogo.html':'./index.html';
    e.respondWith(
      fetch(e.request).then(resp=>{
        const copy=resp.clone();
        caches.open(CACHE).then(c=>c.put(fallback,copy));
        return resp;
      }).catch(()=>caches.match(fallback))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
      const copy=resp.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy));
      return resp;
    }))
  );
});
