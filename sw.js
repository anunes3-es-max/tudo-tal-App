const CACHE='tudo-tal-v12';
const APP=['./','./index.html','./styles.css?v=8','./qr-v1.js?v=2','./app-1.js?v=11','./cloud-sync.js?v=5','./app-2.js','./app-3.js?v=12','./app-4.js?v=8','./analytics.js?v=2','./auth-setup.js?v=3','./app-5.js?v=8','./manifest.webmanifest','./assets/logo.svg','./assets/icon.svg'];

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(APP)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  if(e.request.mode==='navigate'){
    e.respondWith(
      fetch(e.request).then(resp=>{
        const copy=resp.clone();
        caches.open(CACHE).then(c=>c.put('./index.html',copy));
        return resp;
      }).catch(()=>caches.match('./index.html'))
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
