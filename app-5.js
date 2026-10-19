let cameraStream=null,cameraLoop=null,html5Scanner=null,html5QrLoadPromise=null;
function ensureHtml5QrCode(){if(window.Html5Qrcode)return Promise.resolve(true);if(html5QrLoadPromise)return html5QrLoadPromise;html5QrLoadPromise=new Promise(resolve=>{const script=document.createElement("script");script.src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";script.async=true;const timer=setTimeout(()=>resolve(false),10000);script.onload=()=>{clearTimeout(timer);resolve(!!window.Html5Qrcode)};script.onerror=()=>{clearTimeout(timer);resolve(false)};document.head.appendChild(script)});return html5QrLoadPromise}
async function startCamera(){$("#cameraBox").classList.remove("hidden");$("#cameraVideo").classList.add("hidden");$("#html5Reader").classList.add("hidden");if("BarcodeDetector"in window){try{const detector=new BarcodeDetector({formats:["qr_code"]});cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});const video=$("#cameraVideo");video.classList.remove("hidden");video.srcObject=cameraStream;await video.play();const tick=async()=>{if(!cameraStream)return;try{const codes=await detector.detect(video);if(codes.length){$("#saleSku").value=parseScannedValue(codes[0].rawValue);await stopCamera();lookupSaleSku();toast("QR lido.");return}}catch(_){}cameraLoop=requestAnimationFrame(tick)};tick();return}catch(e){}}if(!window.Html5Qrcode)await ensureHtml5QrCode();if(window.Html5Qrcode){try{$("#html5Reader").classList.remove("hidden");html5Scanner=new Html5Qrcode("html5Reader");await html5Scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:220,height:220}},async decodedText=>{$("#saleSku").value=parseScannedValue(decodedText);await stopCamera();lookupSaleSku();toast("QR lido.")},()=>{});return}catch(e){}}$("#cameraBox").classList.add("hidden");toast("Não consegui abrir o leitor de QR. Digite o SKU ou confira a permissão da câmera.")}
async function stopCamera(){if(cameraLoop)cancelAnimationFrame(cameraLoop);cameraLoop=null;if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}if(html5Scanner){try{await html5Scanner.stop()}catch(_){}try{html5Scanner.clear()}catch(_){}html5Scanner=null}$("#cameraVideo").classList.add("hidden");$("#html5Reader").classList.add("hidden");$("#cameraBox").classList.add("hidden")}
let installPrompt=null;function setupInstall(){window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e;$("#installBtn").classList.remove("hidden")});$("#installBtn").addEventListener("click",async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$("#installBtn").classList.add("hidden")}})}
function setupServiceWorker(){
  if(setupServiceWorker.started||!("serviceWorker"in navigator)||!location.protocol.startsWith("http"))return;
  setupServiceWorker.started=true;
  // Ao trocar o cache antigo, baixa novamente as fotos e o estoque oficiais.
  navigator.serviceWorker.addEventListener("controllerchange",()=>window.tudoTalCloud?.syncAndRefresh());
  navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"}).catch(()=>{});
}
async function init(){const authorized=await requireInitialAdminAuth();if(!authorized)return;await tdtAccess.init(window.tdtProfile);if(window.tdtProfile.role==="staff"){setupServiceWorker();return;}await openDb();await loadState();if(window.tudoTalCloud?.syncAll)await window.tudoTalCloud.syncAll();await loadState();fillCategoryOptions();renderDashboard();renderProducts();renderLabelOptions();renderCash();if(typeof initCatalogOrders==="function")await initCatalogOrders();if(typeof initWaitlist==="function")await initWaitlist();setupInstall();$$("[data-nav]").forEach(b=>b.addEventListener("click",()=>{if(b.dataset.nav==="produto-form")resetProductForm();nav(b.dataset.nav)}));$("#productSearch").addEventListener("input",renderProducts);$("#productForm").addEventListener("submit",saveProduct);$("#productCategory").addEventListener("change",()=>syncProductCatalogFields(true));$("#productOffer").addEventListener("change",()=>syncProductCatalogFields());$("#productPhoto").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;state.editPhoto=await fileToPhoto(f);$("#photoPreview").innerHTML=`<img src="${state.editPhoto}" alt="">`});const saleSkuInput=$("#saleSku");let saleScanTimer=null;
saleSkuInput.addEventListener("input",()=>{
  clearTimeout(saleScanTimer);
  saleScanTimer=setTimeout(()=>{
    if(saleSkuInput.value.trim())lookupSaleSku();
  },140);
});
saleSkuInput.addEventListener("change",lookupSaleSku);
saleSkuInput.addEventListener("keydown",e=>{
  if(e.key==="Enter"){
    e.preventDefault();
    clearTimeout(saleScanTimer);
    lookupSaleSku();
  }
});$("#cameraBtn").addEventListener("click",startCamera);$("#stopCameraBtn").addEventListener("click",stopCamera);$("#labelProduct").addEventListener("change",renderLabel);$("#printLabelBtn").addEventListener("click",printLabel);$("#downloadLabelBtn").addEventListener("click",downloadLabel);$("#cashForm").addEventListener("submit",saveCash);$("#exportBtn").addEventListener("click",exportBackup);$("#importBackup")?.addEventListener("change",async e=>{try{await importBackup(e.target.files[0])}catch(err){toast("Não consegui restaurar o backup.")}});$("#syncNowBtn")?.addEventListener("click",async()=>{const ok=await window.tudoTalCloud?.syncAndRefresh();toast(ok?"Dados sincronizados.":"Não consegui sincronizar agora.")});window.addEventListener("online",()=>window.tudoTalCloud?.syncAndRefresh());document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")window.tudoTalCloud?.syncAndRefresh()});window.addEventListener("beforeunload",stopCamera);const url=new URL(location.href),incoming=url.searchParams.get("sku");if(incoming){nav("venda");$("#saleSku").value=incoming;lookupSaleSku()}else nav("dashboard");setupServiceWorker()}
document.addEventListener("DOMContentLoaded",async()=>{
  setupServiceWorker();
  try{await init();}catch(error){
    console.error('Falha ao iniciar Tudo & Tal:',error);
    document.body.classList.add('auth-locked');
    document.querySelector('#authGate')?.classList.remove('hidden');
    authStatus('Não foi possível carregar o administrador. '+(error?.name==='NotFoundError'?'O armazenamento local precisa ser atualizado. ':error?.message||'')+' Feche outras abas do app e tente novamente.','error');
    const button=document.createElement('button');button.type='button';button.textContent='Tentar carregar novamente';button.onclick=()=>location.reload();
    document.querySelector('#authGate')?.append(button);
  }
});
