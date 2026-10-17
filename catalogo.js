"use strict";
const SUPABASE_URL="https://iugryzipeqbgoplwqdqn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_PbXYTHU7fS3VlkcrnvkwLQ_5A5JHwIR";
const client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const S={products:[],section:"all",offer:"all",condition:"",age:"",gender:"",size:"",category:"Todos",query:"",cart:new Map(),config:{store_name:"Tudo & Tal",whatsapp_number:"",reservation_minutes:60}};
const donation={productId:null,posting:false,trigger:null};
const interest={productId:null,posting:false,trigger:null};
const $=s=>document.querySelector(s);
const money=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
function toast(msg){const e=$("#catalogToast");e.textContent=msg;e.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("show"),2600)}
function productById(id){return S.products.find(p=>p.id===id)}
function cartQty(id){return Number(S.cart.get(id)||0)}
function cartLines(){return [...S.cart.entries()].map(([id,qty])=>({p:productById(id),qty})).filter(x=>x.p&&x.qty>0)}
function cartTotal(){return cartLines().reduce((s,x)=>s+Number(x.p.price)*x.qty,0)}
function cartCount(){return cartLines().reduce((s,x)=>s+x.qty,0)}
function safePhoto(p){return p.photo_url||"assets/icon.svg"}
function clothingProduct(p){return TudoTalGroups.groupId(p)==="vestuario"}
function sectionProducts(){return S.products.filter(p=>(!clothingProduct(p)||Number(p.available_qty||0)>0)&&
  (S.section==="all"||(S.section==="vestuario"?clothingProduct(p)&&(S.offer==="all"||TudoTalGroups.isDonation(p)===(S.offer==="donation")):!clothingProduct(p))))}
function sizeKey(value){return TudoTalGroups.sizeKey(value)}
function filteredProducts(){
  const q=TudoTalGroups.normalize(S.query);
  return sectionProducts().filter(p=>(S.category==="Todos"||TudoTalGroups.groupId(p)===S.category)
    &&(S.section!=="vestuario"||TudoTalGroups.matchesClothing(p,S))
    &&(!q||TudoTalGroups.normalize([p.name,p.brand,p.category,TudoTalGroups.group(p).label,p.sku,p.size].join(" ")).includes(q)));
}
function renderCatalogControls(){
  const clothing=S.section==="vestuario";
  $("#clothingTools").classList.toggle("hidden",!clothing);
  $("#catalogSections").querySelectorAll("[data-section]").forEach(b=>{const active=b.dataset.section===S.section;b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active))});
  $("#clothingOffers").querySelectorAll("[data-offer]").forEach(b=>{const active=b.dataset.offer===S.offer;b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active))});
  $("#catalogTitle").textContent=clothing?(S.offer==="donation"?"Doações para retirada grátis":"Vestuário & Brechó"):
    S.category!=="Todos"?TudoTalGroups.groups.find(g=>g.id===S.category).label:S.section==="loja"?"Cuidado pessoal e achadinhos":"Todos os produtos";
  $("#clothingIntro").textContent=S.offer==="donation"?"Escolha uma peça, reserve por 1 hora e combine a retirada grátis na loja. Não é necessário comprar.":"Novos, usados como novos e usados. Aqui aparecem apenas as peças disponíveis. Filtre por condição, público e tamanho.";
  const sizes=[...new Set(sectionProducts().filter(clothingProduct).map(p=>sizeKey(p.size)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR",{numeric:true}));
  if(!sizes.includes(S.size))S.size="";
  $("#sizeFilter").innerHTML='<option value="">Todos</option>'+sizes.map(size=>'<option value="'+esc(size)+'">'+esc(size)+'</option>').join("");
  $("#conditionFilter").value=S.condition;$("#ageFilter").value=S.age;$("#genderFilter").value=S.gender;$("#sizeFilter").value=S.size;
}
function renderCategories(){
  const cats=[{id:"Todos",label:"Todos"},...TudoTalGroups.groups];
  $("#categoryChips").innerHTML=cats.map(c=>'<button type="button" class="chip '+(c.id===S.category&&(c.id!=="Todos"||S.section==="all")?"active":"")+'" aria-pressed="'+(c.id===S.category&&(c.id!=="Todos"||S.section==="all"))+'" data-cat="'+c.id+'">'+esc(c.label)+'</button>').join("");
  $("#categoryChips").querySelectorAll("[data-cat]").forEach(b=>b.onclick=()=>selectCatalogGroup(b.dataset.cat));
}
function resetCatalogClothing(){S.age="";S.gender="";S.size="";S.condition="";S.offer="all"}
function selectCatalogGroup(group){
  if(group!=="Todos"&&!TudoTalGroups.groups.some(g=>g.id===group))return;
  S.category=group;S.section=group==="Todos"?"all":group==="vestuario"?"vestuario":"loja";
  resetCatalogClothing();renderCatalogControls();renderCategories();renderProducts();
}
function selectCatalogSection(section){
  S.section=section;S.category=section==="vestuario"?"vestuario":"Todos";
  resetCatalogClothing();S.query="";$("#catalogSearch").value="";renderCatalogControls();renderCategories();renderProducts();
}
function selectClothingOffer(offer){S.offer=offer;renderCatalogControls();renderProducts()}
function clearClothingFilters(){resetCatalogClothing();S.query="";$("#catalogSearch").value="";renderCatalogControls();renderCategories();renderProducts()}
function renderProducts(){
  const rows=filteredProducts();
  $("#productCount").textContent=rows.length+" produto(s)";
  $("#catalogGrid").innerHTML=rows.length?rows.map(p=>{
    const meta=[p.brand,p.size,TudoTalGroups.conditionValue(p),({adulto:"Adulto",infantil:"Infantil"})[p.age_group],({feminino:"Feminino",masculino:"Masculino",unissex:"Unissex"})[p.gender]].filter(Boolean).join(" • ");
    const stock=Number(p.available_qty||0);
    const discount=Number(p.discount_percent||0),original=Number(p.original_price||p.price||0);
    const priceHtml=p.is_donation?'<div class="product-price donation-price">Grátis</div>':discount>0?'<div class="product-price promo"><small>'+money(original)+'</small><strong>'+money(p.price)+'</strong><span>'+String(discount).replace(".",",")+'% OFF</span></div>':'<div class="product-price">'+money(p.price)+'</div>';
    const soldOut=stock<=0;
    const stockHtml=soldOut?'<span class="stock-pill sold-out">'+(p.is_donation?'Indisponível':'Esgotado')+'</span>':'<span class="stock-pill">'+stock+(stock===1?' disponível':' disponíveis')+'</span>';
    const addHtml=(soldOut||p.is_donation)?'':'<button class="add-btn" type="button" data-add="'+esc(p.id)+'" aria-label="Adicionar '+esc(p.name)+'">+</button>';
    const interestHtml=(soldOut&&!clothingProduct(p))?'<button class="waitlist-btn" type="button" data-interest="'+esc(p.id)+'" aria-label="Quero ser avisado sobre '+esc(p.name)+'">Quero ser avisado</button>':'';
    return '<article class="product-card'+(soldOut?" sold-out":"")+(discount>0?" on-sale":"")+'"><div class="product-photo">'+(discount>0?'<span class="sale-ribbon">'+String(discount).replace(".",",")+'% OFF</span>':'')+'<img src="'+esc(safePhoto(p))+'" alt="'+esc(p.name)+'" loading="lazy"></div><div class="product-body"><div class="product-category">'+esc(p.is_donation?'Doação · retirada na loja':TudoTalGroups.group(p).label)+'</div><div class="product-name">'+esc(p.name)+'</div><div class="product-meta">'+esc(meta||p.sku)+'</div>'+stockHtml+'<div class="product-bottom">'+priceHtml+addHtml+'</div>'+(p.is_donation&&!soldOut?'<button class="donation-btn" type="button" data-donate="'+esc(p.id)+'" aria-label="Quero retirar '+esc(p.name)+' grátis">Quero retirar grátis</button>':'')+interestHtml+'</div></article>';
  }).join(""):'<div class="empty">'+(sectionProducts().length?'Nenhuma peça ou produto com esses filtros. Tente limpar a busca.':S.section==='vestuario'?(S.offer==='donation'?'Novas doações em breve. Volte para conferir as peças gratuitas.':'Novas peças do brechó em breve. Volte para conferir as disponíveis.'):'Nenhum produto disponível no momento.')+'</div>';
  $("#catalogGrid").querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>addToCart(b.dataset.add));
  $("#catalogGrid").querySelectorAll("[data-donate]").forEach(b=>b.onclick=()=>openDonation(b.dataset.donate,b));
  $("#catalogGrid").querySelectorAll("[data-interest]").forEach(b=>b.onclick=()=>openInterest(b.dataset.interest,b));
}
function openInterest(id,trigger){
  const p=productById(id);if(!p)return;
  if(clothingProduct(p))return;
  if(Number(p.available_qty||0)>0){toast("Este produto já está disponível para comprar.");return}
  interest.productId=id;interest.trigger=trigger;
  $("#interestForm").reset();$("#interestForm").classList.remove("hidden");
  $("#interestSuccess").classList.add("hidden");
  $("#interestError").textContent="";$("#interestError").classList.add("hidden");
  $("#interestProductName").textContent=p.name;
  $("#interestProductPhoto").src=safePhoto(p);
  $("#interestModal").classList.remove("hidden");
  $("#interestName").focus();
}
function closeInterest(){
  if(interest.posting)return;
  $("#interestModal").classList.add("hidden");
  $("#interestForm").reset();interest.productId=null;
  const trigger=interest.trigger?.isConnected?interest.trigger:
    [...document.querySelectorAll("[data-interest]")].find(b=>b.dataset.interest===interest.trigger?.dataset.interest);
  if(trigger)trigger.focus();else $("#catalogSearch").focus();
}
function interestError(message){
  $("#interestError").textContent=message;$("#interestError").classList.remove("hidden");
}
async function submitInterest(e){
  e.preventDefault();if(interest.posting||!interest.productId)return;
  const product=productById(interest.productId);
  if(!product||clothingProduct(product)){closeInterest();return}
  const name=$("#interestName").value.trim();
  let phone=$("#interestPhone").value.replace(/\D/g,"");
  if(phone.length===10||phone.length===11)phone="55"+phone;
  if(name.length<2||name.length>80){interestError("Informe seu nome, com 2 a 80 caracteres.");$("#interestName").focus();return}
  if(!/^55[1-9][0-9]([2-9][0-9]{7}|9[0-9]{8})$/.test(phone)){
    interestError("Informe um WhatsApp válido com DDD.");$("#interestPhone").focus();return;
  }
  const button=$("#registerInterestButton");interest.posting=true;
  button.disabled=true;button.textContent="Registrando interesse...";
  $("#interestError").classList.add("hidden");
  try{
    const {error}=await client.rpc("create_catalog_interest",{p_product_id:interest.productId,p_customer_name:name,p_customer_phone:phone});
    if(error)throw error;
    $("#interestForm").reset();$("#interestForm").classList.add("hidden");
    $("#interestSuccess").classList.remove("hidden");$("#interestSuccess").focus();
  }catch(err){
    console.error("Lista de espera",err?.code);
    interestError(err?.code==="22023"?err.message:"Não conseguimos registrar agora. Tente novamente em instantes.");
    await loadProducts();
  }finally{
    interest.posting=false;button.disabled=false;button.textContent="Entrar na lista de espera";
  }
}
function interestKeyboard(e){
  if($("#interestModal").classList.contains("hidden"))return;
  if(e.key==="Escape"){e.preventDefault();closeInterest();return}
  if(e.key!=="Tab")return;
  const items=[...$("#interestModal").querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(el=>el.offsetParent!==null);
  const first=items[0],last=items[items.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
  else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===$("#interestSuccess"))){e.preventDefault();first?.focus()}
}
function addToCart(id){
  const p=productById(id);if(!p)return;
  if(p.is_donation){openDonation(id);return}
  const next=cartQty(id)+1;
  if(next>Number(p.available_qty||0)){toast("Essa é a quantidade máxima disponível.");return}
  S.cart.set(id,next);renderCart();toast("Adicionado à sacola.");
}
function setQty(id,delta){
  const p=productById(id);if(!p)return;
  const next=cartQty(id)+delta;
  if(next<=0)S.cart.delete(id);
  else if(next<=Number(p.available_qty||0))S.cart.set(id,next);
  else toast("Não há mais unidades disponíveis.");
  renderCart();
}
function renderCart(){
  const lines=cartLines();
  $("#cartCount").textContent=cartCount();
  $("#cartTotal").textContent=money(cartTotal());
  $("#checkoutTotal").textContent=money(cartTotal());
  $("#cartItems").innerHTML=lines.length?lines.map(({p,qty})=>'<div class="cart-row"><img src="'+esc(safePhoto(p))+'" alt=""><div><strong>'+esc(p.name)+'</strong><small>'+money(p.price)+' cada</small><div class="qty-controls"><button data-minus="'+esc(p.id)+'">−</button><b>'+qty+'</b><button data-plus="'+esc(p.id)+'">+</button></div><button class="remove-btn" data-remove="'+esc(p.id)+'">remover</button></div><div class="cart-line-price">'+money(Number(p.price)*qty)+'</div></div>').join(""):'<div class="empty">Sua sacola está vazia.</div>';
  $("#checkoutButton").disabled=!lines.length;
  $("#cartItems").querySelectorAll("[data-minus]").forEach(b=>b.onclick=()=>setQty(b.dataset.minus,-1));
  $("#cartItems").querySelectorAll("[data-plus]").forEach(b=>b.onclick=()=>setQty(b.dataset.plus,1));
  $("#cartItems").querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{S.cart.delete(b.dataset.remove);renderCart()});
}
function openCart(){renderCart();$("#drawerBackdrop").classList.remove("hidden");$("#cartDrawer").classList.add("open");$("#cartDrawer").setAttribute("aria-hidden","false")}
function closeCart(){$("#drawerBackdrop").classList.add("hidden");$("#cartDrawer").classList.remove("open");$("#cartDrawer").setAttribute("aria-hidden","true")}
function openCheckout(){if(!cartLines().length)return;closeCart();$("#checkoutModal").classList.remove("hidden");$("#checkoutTotal").textContent=money(cartTotal())}
function normalizeStorePhone(raw){const d=String(raw||"").replace(/\D/g,"");if(!d)return"";return d.length<=11?"55"+d:d}
function makeWhatsAppMessage(order,customer,fulfillment){
  const lines=cartLines().map(x=>"• "+x.qty+"x "+x.p.name+" — "+money(Number(x.p.price)*x.qty));
  return "Olá! Fiz o pedido *"+order.order_number+"* no Catálogo Tudo & Tal.\n\n"+lines.join("\n")+"\n\n*Total:* "+money(order.subtotal)+"\n*Nome:* "+customer+"\n*Recebimento:* "+fulfillment+"\n\nQuero finalizar a compra.";
}
async function submitOrder(e){
  e.preventDefault();
  const btn=$("#placeOrderButton");btn.disabled=true;btn.textContent="Registrando pedido...";
  const name=$("#customerName").value.trim(),phone=$("#customerPhone").value.trim(),fulfillment=$("#fulfillment").value,notes=$("#orderNotes").value.trim();
  const items=cartLines().map(x=>({product_id:x.p.id,qty:x.qty}));
  try{
    const {data,error}=await client.rpc("create_catalog_order",{p_customer_name:name,p_customer_phone:phone,p_fulfillment:fulfillment,p_notes:notes||null,p_items:items});
    if(error)throw error;
    const message=makeWhatsAppMessage(data,name,fulfillment);
    const storePhone=normalizeStorePhone(S.config.whatsapp_number);
    const wa=storePhone?"https://wa.me/"+storePhone+"?text="+encodeURIComponent(message):"";
    $("#checkoutModal").classList.add("hidden");
    $("#successTitle").textContent="Pedido "+data.order_number+" recebido!";
    const expires=new Date(data.reservation_expires_at);
    $("#successText").textContent="Seus itens estão reservados até "+expires.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})+". O pedido já apareceu para a equipe da Tudo & Tal.";
    const link=$("#whatsappLink");
    if(wa){link.href=wa;link.classList.remove("hidden")}else{link.classList.add("hidden");$("#successText").textContent+=" O WhatsApp da loja ainda precisa ser configurado pelo administrador."}
    $("#successModal").classList.remove("hidden");
    S.cart.clear();renderCart();
    await loadProducts();
    if(wa)setTimeout(()=>{location.href=wa},700);
  }catch(err){
    console.error(err);
    const msg=String(err?.message||"Não conseguimos criar o pedido.");
    toast(msg.includes("Estoque")||msg.includes("disponível")?msg:"Não conseguimos criar o pedido agora. Confira os dados e tente novamente.");
    await loadProducts();
  }finally{btn.disabled=false;btn.textContent="Criar pedido e ir para o WhatsApp"}
}
async function loadConfig(){
  const {data,error}=await client.rpc("get_catalog_config");
  if(!error&&data)S.config=data;
}
async function loadProducts(){
  const {data,error}=await client.rpc("get_catalog_products_v2");
  if(error){console.error(error);$("#catalogGrid").innerHTML='<div class="empty">Não consegui carregar o catálogo agora. Tente atualizar a página.</div>';return}
  S.products=data||[];
  for(const [id,qty] of [...S.cart.entries()]){
    const p=productById(id);
    if(!p||p.is_donation||Number(p.available_qty||0)<=0)S.cart.delete(id); else if(qty>Number(p.available_qty||0))S.cart.set(id,Number(p.available_qty||0));
  }
  renderCatalogControls();renderCategories();renderProducts();renderCart();
}
async function init(){
  $("#catalogSections").querySelectorAll("[data-section]").forEach(b=>b.onclick=()=>selectCatalogSection(b.dataset.section));
  $("#clothingOffers").querySelectorAll("[data-offer]").forEach(b=>b.onclick=()=>selectClothingOffer(b.dataset.offer));
  for(const [id,key] of [["conditionFilter","condition"],["ageFilter","age"],["genderFilter","gender"],["sizeFilter","size"]])$("#"+id).addEventListener("change",e=>{S[key]=e.target.value;renderProducts()});
  $("#clearClothingFilters").onclick=clearClothingFilters;
  $("#closeDonation").onclick=closeDonation;$("#donationForm").addEventListener("submit",submitDonation);
  $("#donationModal").addEventListener("click",e=>{if(e.target===$("#donationModal"))closeDonation()});
  document.addEventListener("keydown",donationKeyboard);
  $("#cartButton").onclick=openCart;$("#closeCart").onclick=closeCart;$("#drawerBackdrop").onclick=closeCart;
  $("#checkoutButton").onclick=openCheckout;$("#closeCheckout").onclick=()=>$("#checkoutModal").classList.add("hidden");
  $("#checkoutForm").addEventListener("submit",submitOrder);
  $("#backCatalog").onclick=()=>$("#successModal").classList.add("hidden");
  $("#closeInterest").onclick=closeInterest;$("#backFromInterest").onclick=closeInterest;
  $("#interestForm").addEventListener("submit",submitInterest);
  $("#interestModal").addEventListener("click",e=>{if(e.target===$("#interestModal"))closeInterest()});
  document.addEventListener("keydown",interestKeyboard);
  $("#catalogSearch").addEventListener("input",e=>{S.query=e.target.value;renderProducts()});
  await Promise.all([loadConfig(),loadProducts()]);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")loadProducts()});
  setInterval(()=>{if(document.visibilityState==="visible")loadProducts()},30000);
}
document.addEventListener("DOMContentLoaded",init);


function openDonation(id,trigger){
  const p=productById(id);if(!p||!p.is_donation||Number(p.available_qty||0)<1){toast("Esta peça não está mais disponível para retirada.");return}
  donation.productId=id;donation.trigger=trigger;
  $("#donationForm").reset();$("#donationError").classList.add("hidden");
  $("#donationProductName").textContent=p.name+(p.size?" · "+p.size:"");$("#donationProductPhoto").src=safePhoto(p);
  $("#donationModal").classList.remove("hidden");$("#donationName").focus();
}
function closeDonation(){
  if(donation.posting)return;
  $("#donationModal").classList.add("hidden");$("#donationForm").reset();donation.productId=null;
  if(donation.trigger?.isConnected)donation.trigger.focus();else $("#catalogSearch").focus();
}
function showDonationError(message){$("#donationError").textContent=message;$("#donationError").classList.remove("hidden")}
async function submitDonation(e){
  e.preventDefault();if(donation.posting||!donation.productId)return;
  const name=$("#donationName").value.trim(),notes=$("#donationNotes").value.trim();
  let phone=$("#donationPhone").value.replace(/\D/g,"");if(phone.length===10||phone.length===11)phone="55"+phone;
  if(name.length<2||name.length>80){showDonationError("Informe seu nome, com 2 a 80 caracteres.");return}
  if(!/^55[1-9][0-9]([2-9][0-9]{7}|9[0-9]{8})$/.test(phone)){showDonationError("Informe um WhatsApp válido com DDD.");return}
  const p=productById(donation.productId),button=$("#reserveDonationButton");
  donation.posting=true;button.disabled=true;button.textContent="Reservando peça...";$("#donationError").classList.add("hidden");
  try{
    const {data,error}=await client.rpc("create_catalog_donation",{p_product_id:donation.productId,p_customer_name:name,p_customer_phone:phone,p_notes:notes||null});
    if(error)throw error;
    const message="Olá! Reservei a doação *"+data.order_number+"* na Tudo & Tal.\n\nPeça: "+p.name+(p.size?" · "+p.size:"")+"\nNome: "+name+"\nRetirada gratuita na loja. Quero combinar o horário para buscar.";
    const storePhone=normalizeStorePhone(S.config.whatsapp_number),link=$("#whatsappLink");
    link.classList.toggle("hidden",!storePhone);if(storePhone)link.href="https://wa.me/"+storePhone+"?text="+encodeURIComponent(message);
    $("#donationModal").classList.add("hidden");$("#donationForm").reset();donation.productId=null;
    $("#successTitle").textContent="Sua peça está reservada!";
    $("#successText").textContent="Reserva "+data.order_number+" até "+new Date(data.reservation_expires_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})+". Retirada grátis na loja. Combine o horário com a equipe pelo WhatsApp. Depois do prazo, a peça volta a ficar disponível.";
    $("#successModal").classList.remove("hidden");$("#backCatalog").focus();await loadProducts();
  }catch(err){
    console.error("Doação",err?.code);showDonationError(["22023","P0001","P0002"].includes(err?.code)?err.message:"Não conseguimos reservar agora. Tente novamente.");await loadProducts();
  }finally{donation.posting=false;button.disabled=false;button.textContent="Reservar para retirada grátis"}
}
function donationKeyboard(e){
  if($("#donationModal").classList.contains("hidden"))return;
  if(e.key==="Escape"){e.preventDefault();closeDonation();return}
  if(e.key!=="Tab")return;
  const items=[...$("#donationModal").querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')].filter(el=>el.offsetParent!==null),first=items[0],last=items[items.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
}
