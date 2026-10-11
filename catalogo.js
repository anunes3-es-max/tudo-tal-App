"use strict";
const SUPABASE_URL="https://iugryzipeqbgoplwqdqn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_PbXYTHU7fS3VlkcrnvkwLQ_5A5JHwIR";
const client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const S={products:[],category:"Todos",query:"",cart:new Map(),config:{store_name:"Tudo & Tal",whatsapp_number:"",reservation_minutes:60}};
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
function renderCategories(){
  const cats=["Todos",...new Set(S.products.map(p=>p.category).filter(Boolean))];
  $("#categoryChips").innerHTML=cats.map(c=>'<button class="chip '+(c===S.category?"active":"")+'" data-cat="'+esc(c)+'">'+esc(c)+'</button>').join("");
  $("#categoryChips").querySelectorAll("[data-cat]").forEach(b=>b.onclick=()=>{S.category=b.dataset.cat;renderCategories();renderProducts()});
}
function renderProducts(){
  const q=S.query.trim().toLowerCase();
  const rows=S.products.filter(p=>(S.category==="Todos"||p.category===S.category)&&(!q||[p.name,p.brand,p.category,p.sku,p.size].join(" ").toLowerCase().includes(q)));
  $("#productCount").textContent=rows.length+" produto(s)";
  $("#catalogGrid").innerHTML=rows.length?rows.map(p=>{
    const meta=[p.brand,p.size,p.condition].filter(Boolean).join(" • ");
    const stock=Number(p.available_qty||0);
    const discount=Number(p.discount_percent||0),original=Number(p.original_price||p.price||0);
    const priceHtml=discount>0?'<div class="product-price promo"><small>'+money(original)+'</small><strong>'+money(p.price)+'</strong><span>'+String(discount).replace(".",",")+'% OFF</span></div>':'<div class="product-price">'+money(p.price)+'</div>';
    return '<article class="product-card'+(discount>0?" on-sale":"")+'"><div class="product-photo">'+(discount>0?'<span class="sale-ribbon">'+String(discount).replace(".",",")+'% OFF</span>':'')+'<img src="'+esc(safePhoto(p))+'" alt="'+esc(p.name)+'" loading="lazy"></div><div class="product-body"><div class="product-category">'+esc(p.category||"Tudo & Tal")+'</div><div class="product-name">'+esc(p.name)+'</div><div class="product-meta">'+esc(meta||p.sku)+'</div><span class="stock-pill">'+stock+' disponível'+(stock===1?"":"is")+'</span><div class="product-bottom">'+priceHtml+'<button class="add-btn" data-add="'+esc(p.id)+'" aria-label="Adicionar '+esc(p.name)+'">+</button></div></div></article>';
  }).join(""):'<div class="empty">Nenhum produto encontrado com esse filtro.</div>';
  $("#catalogGrid").querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>addToCart(b.dataset.add));
}
function addToCart(id){
  const p=productById(id);if(!p)return;
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
  const {data,error}=await client.rpc("get_catalog_products");
  if(error){console.error(error);$("#catalogGrid").innerHTML='<div class="empty">Não consegui carregar o catálogo agora. Tente atualizar a página.</div>';return}
  S.products=data||[];
  for(const [id,qty] of [...S.cart.entries()]){
    const p=productById(id);
    if(!p)S.cart.delete(id); else if(qty>Number(p.available_qty||0))S.cart.set(id,Number(p.available_qty||0));
  }
  renderCategories();renderProducts();renderCart();
}
async function init(){
  $("#cartButton").onclick=openCart;$("#closeCart").onclick=closeCart;$("#drawerBackdrop").onclick=closeCart;
  $("#checkoutButton").onclick=openCheckout;$("#closeCheckout").onclick=()=>$("#checkoutModal").classList.add("hidden");
  $("#checkoutForm").addEventListener("submit",submitOrder);
  $("#backCatalog").onclick=()=>$("#successModal").classList.add("hidden");
  $("#catalogSearch").addEventListener("input",e=>{S.query=e.target.value;renderProducts()});
  await Promise.all([loadConfig(),loadProducts()]);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")loadProducts()});
  setInterval(()=>{if(document.visibilityState==="visible")loadProducts()},30000);
}
document.addEventListener("DOMContentLoaded",init);
