"use strict";
(function(){
  let orders=[];
  let filter="Todos";
  let channel=null;
  let config={whatsapp_number:"",reservation_minutes:60};

  const c=()=>window.tudoTalSupabase;
  const statuses=["Todos","Novo","Em atendimento","Aguardando pagamento","Pago","Concluído","Expirado"];
  const activeStatus=new Set(["Novo","Em atendimento","Aguardando pagamento","Pago"]);
  const phoneForWa=v=>{const d=String(v||"").replace(/\D/g,"");return d.length<=11?"55"+d:d};
  const fmtDate=v=>v?new Date(v).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"";
  const orderTotal=o=>Number(o.subtotal||0);

  function beep(){
    try{
      const A=window.AudioContext||window.webkitAudioContext,ctx=new A(),osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.connect(gain);gain.connect(ctx.destination);osc.frequency.value=820;gain.gain.setValueAtTime(.0001,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.12,ctx.currentTime+.02);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.35);
      osc.start();osc.stop(ctx.currentTime+.37);
    }catch(_){}
  }
  function countNew(){return orders.filter(o=>o.status==="Novo").length}
  function updateBadges(){
    const n=countNew(),badge=document.querySelector("#orderBadge"),quick=document.querySelector("#orderQuickBadge"),bell=document.querySelector("#orderBell");
    if(badge){badge.textContent=n;badge.classList.toggle("hidden",!n)}
    if(quick){quick.textContent=n;quick.classList.toggle("hidden",!n)}
    if(bell)bell.classList.toggle("has-orders",!!n);
  }
  function renderSummary(){
    const el=document.querySelector("#orderSummary");if(!el)return;
    const rows=[
      ["Novos",orders.filter(o=>o.status==="Novo").length,"new"],
      ["Em atendimento",orders.filter(o=>o.status==="Em atendimento").length,"service"],
      ["Aguardando pagamento",orders.filter(o=>o.status==="Aguardando pagamento").length,"wait"],
      ["Concluídos",orders.filter(o=>o.status==="Concluído").length,"done"]
    ];
    el.innerHTML=rows.map(x=>'<div class="order-kpi '+x[2]+'"><span>'+x[0]+'</span><strong>'+x[1]+'</strong></div>').join("");
  }
  function renderFilters(){
    const el=document.querySelector("#orderFilters");if(!el)return;
    el.innerHTML=statuses.map(s=>'<button class="'+(filter===s?"active":"")+'" data-order-filter="'+esc(s)+'">'+esc(s)+'</button>').join("");
    el.querySelectorAll("[data-order-filter]").forEach(b=>b.onclick=()=>{filter=b.dataset.orderFilter;renderFilters();renderOrders()});
  }
  function statusClass(s){return {"Novo":"new","Em atendimento":"service","Aguardando pagamento":"wait","Pago":"paid","Concluído":"done","Cancelado":"cancel","Expirado":"expired"}[s]||""}
  function renderOrders(){
    const el=document.querySelector("#catalogOrdersList");if(!el)return;
    const rows=filter==="Todos"?orders:orders.filter(o=>o.status===filter);
    el.innerHTML=rows.length?rows.map(o=>{
      const items=(o.catalog_order_items||[]).map(i=>'<div class="order-item"><span>'+i.qty+'× '+esc(i.product_name)+'</span><strong>'+money(i.total)+'</strong></div>').join("");
      const exp=activeStatus.has(o.status)&&o.status!=="Pago"?'<span>Reserva até '+fmtDate(o.reservation_expires_at)+'</span>':"";
      const wa="https://wa.me/"+phoneForWa(o.customer_phone)+"?text="+encodeURIComponent("Olá "+o.customer_name+"! Estou entrando em contato sobre seu pedido "+o.order_number+" da Tudo & Tal.");
      const action=o.status!=="Concluído"&&o.status!=="Cancelado"&&o.status!=="Expirado"
        ?'<button class="primary mini-order" data-finalize="'+o.id+'">Registrar venda</button>'
        :"";
      const statusOptions=[
        ["Novo","Novo"],
        ["Em atendimento","Em atendimento"],
        ["Aguardando pagamento","Aguardando pagamento"],
        ["Pago","Pago"],
        ["Cancelado","Cancelar e apagar"]
      ].map(([value,label])=>'<option value="'+value+'" '+(o.status===value?"selected":"")+'>'+label+'</option>').join("");
      const selector=o.status!=="Concluído"&&o.status!=="Expirado"
        ?'<div class="order-status-edit"><select class="input" data-status-select="'+o.id+'">'+statusOptions+'</select><button class="secondary mini-order" data-save-status="'+o.id+'">Salvar status</button></div>'
        :"";
      return '<article class="order-card '+statusClass(o.status)+'"><div class="order-head"><div><div class="order-number">'+esc(o.order_number)+'</div><h3>'+esc(o.customer_name)+'</h3><div class="meta">'+fmtDate(o.created_at)+' • '+esc(o.customer_phone)+' • '+esc(o.fulfillment)+'</div></div><span class="order-status '+statusClass(o.status)+'">'+esc(o.status)+'</span></div><div class="order-items">'+items+'</div><div class="order-total"><span>Total</span><strong>'+money(orderTotal(o))+'</strong></div>'+(o.notes?'<div class="order-note">“'+esc(o.notes)+'”</div>':"")+'<div class="order-reservation">'+exp+'</div>'+selector+'<div class="order-actions"><a class="secondary mini-order" href="'+wa+'" target="_blank" rel="noopener">WhatsApp</a>'+action+'</div></article>';
    }).join(""):'<div class="empty">Nenhum pedido neste status.</div>';
    el.querySelectorAll("[data-save-status]").forEach(b=>b.onclick=()=>saveStatus(b.dataset.saveStatus));
    el.querySelectorAll("[data-finalize]").forEach(b=>b.onclick=()=>openFinalize(b.dataset.finalize));
  }
  async function fetchOrders(silent=false){
    if(!c())return;
    try{
      await c().rpc("get_catalog_products");
      const {data,error}=await c().from("catalog_orders").select("*,catalog_order_items(*)").order("created_at",{ascending:false}).limit(120);
      if(error)throw error;
      orders=data||[];renderSummary();renderFilters();renderOrders();updateBadges();
    }catch(err){console.error("Pedidos catálogo",err);if(!silent)toast("Não consegui carregar os pedidos do catálogo.")}
  }
  async function saveStatus(id){
    const sel=document.querySelector('[data-status-select="'+id+'"]');if(!sel)return;
    const next=sel.value;
    if(next==="Cancelado"&&!confirm("Cancelar este pedido vai apagá-lo do sistema e liberar a reserva. Continuar?")){
      await fetchOrders(true);
      return;
    }
    try{
      const {data,error}=await c().rpc("update_catalog_order_status",{p_order_id:id,p_status:next});
      if(error)throw error;
      toast(next==="Cancelado"?"Pedido cancelado, apagado e estoque liberado.":"Status do pedido atualizado.");
      await fetchOrders(true);
    }catch(err){console.error(err);toast("Não consegui atualizar o pedido: "+String(err?.message||"erro").slice(0,90))}
  }
  function ensureModal(){
    if(document.querySelector("#orderFinalizeModal"))return;
    const wrap=document.createElement("div");
    wrap.id="orderFinalizeModal";wrap.className="order-modal-backdrop hidden";
    wrap.innerHTML='<section class="order-modal"><button class="order-modal-close" type="button">×</button><p class="eyebrow">FINALIZAR PEDIDO</p><h2>Registrar como venda</h2><p id="finalizeOrderLabel" class="hint"></p><form id="finalizeOrderForm"><input type="hidden" id="finalizeOrderId"><label>Pagamento<select id="orderPayment" class="input"><option>Pix</option><option>Dinheiro</option><option>Débito</option><option>Crédito à vista</option><option>Crédito parcelado</option><option>Crediário VIP</option></select></label><div id="orderPaymentExtra"></div><div class="two"><label>Tipo de cliente<select id="orderCustomerType" class="input"><option value="nao_informado">Não informado</option><option value="novo">Cliente novo</option><option value="recorrente">Cliente recorrente</option></select></label><label>Perfil da compra<select id="orderPurchaseProfile" class="input"><option value="nao_informado">Não informado</option><option value="uso_proprio">Uso próprio</option><option value="presente">Presente</option><option value="revenda">Revenda</option><option value="outro">Outro</option></select></label></div><button class="primary wide" id="confirmOrderSale" type="submit">Confirmar pagamento e registrar venda</button></form></section>';
    document.body.appendChild(wrap);
    wrap.querySelector(".order-modal-close").onclick=()=>wrap.classList.add("hidden");
    wrap.addEventListener("click",e=>{if(e.target===wrap)wrap.classList.add("hidden")});
    wrap.querySelector("#orderPayment").onchange=renderPaymentExtra;
    wrap.querySelector("#finalizeOrderForm").onsubmit=confirmOrder;
  }
  function renderPaymentExtra(){
    const p=document.querySelector("#orderPayment")?.value,el=document.querySelector("#orderPaymentExtra");if(!el)return;
    if(p==="Crédito parcelado"){
      el.innerHTML='<div class="three"><label>Parcelas<select id="orderInstallments" class="input">'+Array.from({length:11},(_,i)=>'<option value="'+(i+2)+'">'+(i+2)+'x</option>').join("")+'</select></label><label>Bandeira<select id="orderCardBrand" class="input"><option>Visa/Mastercard</option><option>Elo/Amex</option></select></label><label>Recebimento<select id="orderReceivingPlan" class="input"><option value="one_day">1 dia útil</option><option value="instant">Na hora</option></select></label></div><label>Faixa InfinitePay<select id="orderRateTier" class="input"><option value="up_to_20">Até R$ 20 mil/mês</option><option value="above_20">Acima de R$ 20 mil</option><option value="above_40">Acima de R$ 40 mil</option><option value="above_80">Acima de R$ 80 mil</option></select></label>';
    }else if(p==="Débito"||p==="Crédito à vista"){
      el.innerHTML='<div class="three"><label>Bandeira<select id="orderCardBrand" class="input"><option>Visa/Mastercard</option><option>Elo/Amex</option></select></label><label>Recebimento<select id="orderReceivingPlan" class="input"><option value="one_day">1 dia útil</option><option value="instant">Na hora</option></select></label><label>Faixa InfinitePay<select id="orderRateTier" class="input"><option value="up_to_20">Até R$ 20 mil/mês</option><option value="above_20">Acima de R$ 20 mil</option><option value="above_40">Acima de R$ 40 mil</option><option value="above_80">Acima de R$ 80 mil</option></select></label></div>';
    }else if(p==="Crediário VIP"){
      const d=new Date();d.setDate(d.getDate()+30);
      el.innerHTML='<div class="two"><label>Parcelas<input id="orderInstallments" class="input" type="number" min="1" max="24" value="2"></label><label>1º vencimento<input id="orderFirstDueDate" class="input" type="date" value="'+d.toISOString().slice(0,10)+'"></label></div>';
    }else el.innerHTML="";
  }
  function openFinalize(id){
    ensureModal();const o=orders.find(x=>x.id===id);if(!o)return;
    document.querySelector("#finalizeOrderId").value=id;
    document.querySelector("#finalizeOrderLabel").textContent=o.order_number+" • "+o.customer_name+" • "+money(o.subtotal);
    document.querySelector("#orderFinalizeModal").classList.remove("hidden");renderPaymentExtra();
  }
  async function confirmOrder(e){
    e.preventDefault();
    const id=document.querySelector("#finalizeOrderId").value,payment=document.querySelector("#orderPayment").value,btn=document.querySelector("#confirmOrderSale");
    btn.disabled=true;btn.textContent="Registrando venda...";
    try{
      const {data,error}=await c().rpc("confirm_catalog_order",{
        p_order_id:id,p_payment:payment,
        p_installments:Number(document.querySelector("#orderInstallments")?.value||1),
        p_first_due_date:document.querySelector("#orderFirstDueDate")?.value||null,
        p_card_brand:document.querySelector("#orderCardBrand")?.value||null,
        p_receiving_plan:document.querySelector("#orderReceivingPlan")?.value||"one_day",
        p_rate_tier:document.querySelector("#orderRateTier")?.value||"up_to_20",
        p_customer_type:document.querySelector("#orderCustomerType").value,
        p_purchase_profile:document.querySelector("#orderPurchaseProfile").value
      });
      if(error)throw error;
      document.querySelector("#orderFinalizeModal").classList.add("hidden");
      if(window.tudoTalCloud?.syncAndRefresh)await window.tudoTalCloud.syncAndRefresh();
      await fetchOrders(true);toast("Pedido concluído e venda registrada no sistema.");
    }catch(err){console.error(err);toast("Não consegui concluir: "+String(err?.message||"erro").slice(0,105))}
    finally{btn.disabled=false;btn.textContent="Confirmar pagamento e registrar venda"}
  }
  async function loadConfig(){
    if(!c())return;
    const {data,error}=await c().from("catalog_config").select("*").eq("id",1).maybeSingle();
    if(error){console.error(error);return}
    if(data)config=data;
    const phone=document.querySelector("#catalogWhatsapp"),mins=document.querySelector("#catalogReservationMinutes"),status=document.querySelector("#catalogConfigStatus");
    if(phone)phone.value=config.whatsapp_number||"";
    if(mins)mins.value=config.reservation_minutes||60;
    if(status)status.textContent=config.whatsapp_number?"WhatsApp do catálogo configurado.":"⚠️ Configure o WhatsApp da loja para o cliente ser encaminhado ao finalizar.";
  }
  async function saveConfig(){
    const phone=document.querySelector("#catalogWhatsapp")?.value||"",mins=Number(document.querySelector("#catalogReservationMinutes")?.value||60);
    try{
      const {data,error}=await c().rpc("update_catalog_config",{p_whatsapp_number:phone,p_reservation_minutes:mins});
      if(error)throw error;config=data||config;toast("Configuração do catálogo salva.");await loadConfig();
    }catch(err){console.error(err);toast("Não consegui salvar: "+String(err?.message||"erro").slice(0,90))}
  }
  function subscribe(){
    if(!c()||channel)return;
    channel=c().channel("catalog-orders-admin")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"catalog_orders"},payload=>{
        beep();toast("🛍️ Novo pedido do catálogo: "+(payload.new?.order_number||""));
        fetchOrders(true);
      })
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"catalog_orders"},()=>fetchOrders(true))
      .on("postgres_changes",{event:"DELETE",schema:"public",table:"catalog_orders"},()=>fetchOrders(true))
      .subscribe();
  }
  window.renderCatalogOrders=()=>fetchOrders(true);
  window.initCatalogOrders=async function(){
    ensureModal();
    document.querySelector("#saveCatalogConfig")?.addEventListener("click",saveConfig);
    document.querySelector("#orderBell")?.addEventListener("click",()=>nav("pedidos"));
    await Promise.all([loadConfig(),fetchOrders(true)]);
    subscribe();
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")fetchOrders(true)});
  };
})();
