"use strict";
(function(){
  const statuses=["Aguardando reposição","Avisado","Atendido"];
  const filters=["Pendentes","Prontos para avisar","Aguardando reposição","Avisados","Atendidos","Todos"];
  let interests=[],products=new Map(),filter="Pendentes",query="",loading=null,initialized=false;
  const client=()=>window.tudoTalSupabase;
  const pending=row=>row.status!=="Atendido";
  const available=row=>Number(products.get(row.product_id)?.available_qty||0);
  const ready=row=>row.status==="Aguardando reposição"&&available(row)>0;
  const date=value=>new Date(value).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});

  function renderBadges(){
    const n=interests.filter(pending).length;
    document.querySelectorAll("[data-waitlist-badge]").forEach(el=>{
      el.textContent=n;el.classList.toggle("hidden",!n);
    });
  }
  function renderSummary(){
    const el=document.querySelector("#waitlistSummary");if(!el)return;
    const rows=[
      ["Interesses em aberto",interests.filter(pending).length,"new"],
      ["Produtos procurados",new Set(interests.filter(pending).map(row=>row.product_id)).size,"service"],
      ["Prontos para avisar",interests.filter(ready).length,"done"],
      ["Atendidos",interests.filter(row=>row.status==="Atendido").length,"done"]
    ];
    el.innerHTML=rows.map(([label,value,cls])=>'<div class="order-kpi '+cls+'"><span>'+label+'</span><strong>'+value+'</strong></div>').join("");
  }
  function renderFilters(){
    const el=document.querySelector("#waitlistFilters");if(!el)return;
    el.innerHTML=filters.map(value=>'<button type="button" class="'+(filter===value?"active":"")+'" data-waitlist-filter="'+esc(value)+'">'+esc(value)+'</button>').join("");
    el.querySelectorAll("[data-waitlist-filter]").forEach(button=>button.onclick=()=>{
      filter=button.dataset.waitlistFilter;renderFilters();renderList();
    });
  }
  function matches(row){
    if(filter==="Pendentes"&&!pending(row))return false;
    if(filter==="Prontos para avisar"&&!ready(row))return false;
    if(filter==="Aguardando reposição"&&row.status!=="Aguardando reposição")return false;
    if(filter==="Avisados"&&row.status!=="Avisado")return false;
    if(filter==="Atendidos"&&row.status!=="Atendido")return false;
    const product=row.products||{};
    const haystack=[row.customer_name,row.customer_phone,product.name,product.sku,product.brand,product.category].join(" ").toLowerCase();
    if(!query)return true;
    return haystack.includes(query)||(/^\+?[\d\s()-]+$/.test(query)&&row.customer_phone.includes(query.replace(/\D/g,"")));
  }
  function customerHtml(row){
    const product=row.products||{},stock=available(row);
    const message=stock>0
      ?"Olá "+row.customer_name+"! O produto "+product.name+" voltou ao estoque da Tudo & Tal. Você demonstrou interesse nele. Veja a disponibilidade no catálogo: https://tudoetalstore.github.io/"
      :"Olá "+row.customer_name+"! Aqui é da Tudo & Tal. Estou entrando em contato sobre seu interesse no produto "+product.name+".";
    const wa="https://wa.me/"+row.customer_phone+"?text="+encodeURIComponent(message);
    const options=statuses.map(status=>'<option value="'+esc(status)+'" '+(row.status===status?"selected":"")+'>'+esc(status)+'</option>').join("");
    return '<div class="waitlist-customer"><div class="waitlist-customer-info"><strong>'+esc(row.customer_name)+'</strong><div class="meta">'+esc(row.customer_phone)+' • '+date(row.created_at)+'</div><span class="waitlist-status '+(row.status==="Atendido"?"done":row.status==="Avisado"?"notified":"waiting")+'">'+esc(row.status)+'</span>'+(ready(row)?'<span class="waitlist-ready">Já pode avisar</span>':'')+(row.notified_at?'<div class="meta">Avisado em '+date(row.notified_at)+'</div>':'')+'</div><div class="waitlist-customer-actions"><a class="secondary mini-order" href="'+esc(wa)+'" target="_blank" rel="noopener">Abrir WhatsApp</a><div class="waitlist-status-edit"><select class="input" data-interest-status="'+row.id+'" aria-label="Status de '+esc(row.customer_name)+'">'+options+'</select><button class="secondary mini-order" type="button" data-save-interest="'+row.id+'">Salvar</button></div></div></div>';
  }
  function renderList(){
    const el=document.querySelector("#waitlistList");if(!el)return;
    const groups=new Map();
    interests.filter(matches).forEach(row=>{
      if(!groups.has(row.product_id))groups.set(row.product_id,{product:row.products||{},rows:[],total:interests.filter(x=>x.product_id===row.product_id&&pending(x)).length});
      groups.get(row.product_id).rows.push(row);
    });
    const sorted=[...groups.values()].sort((a,b)=>b.total-a.total||String(a.product.name||"").localeCompare(String(b.product.name||""),"pt-BR"));
    el.innerHTML=sorted.length?sorted.map(group=>{
      const p=group.product,stock=available(group.rows[0]),active=p.active!==false;
      const label=!active?"Fora do catálogo":stock>0?stock+" disponível"+(stock===1?"":"is"):"Esgotado";
      group.rows.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
      const meta=[p.sku,p.brand,p.size].filter(Boolean).join(" • ");
      return '<article class="panel waitlist-product"><div class="waitlist-product-head"><img src="'+esc(p.photo_url||"assets/icon.svg")+'" alt=""><div><p class="eyebrow">'+group.total+' interesse'+(group.total===1?"":"s")+' em aberto</p><h2>'+esc(p.name||"Produto indisponível")+'</h2><div class="meta">'+esc(meta)+'</div><span class="waitlist-stock '+(stock>0?"available":"")+'">'+label+'</span></div></div><div class="waitlist-customers">'+group.rows.map(customerHtml).join("")+'</div></article>';
    }).join(""):'<div class="empty">'+(interests.length?"Nenhum interesse corresponde a este filtro.":"Ainda não há interessados. Os cadastros feitos nos produtos esgotados aparecerão aqui.")+'</div>';
    el.querySelectorAll("[data-save-interest]").forEach(button=>button.onclick=()=>saveStatus(button.dataset.saveInterest,button));
  }
  async function readAll(){
    const rows=[];
    for(let offset=0;;offset+=500){
      const {data,error}=await client().from("catalog_waitlist")
        .select("id,product_id,customer_name,customer_phone,status,created_at,updated_at,notified_at,products(id,sku,name,category,brand,size,qty,active,photo_url)")
        .order("created_at",{ascending:false}).order("id").range(offset,offset+499);
      if(error)throw error;rows.push(...(data||[]));if((data||[]).length<500)return rows;
    }
  }
  async function fetchInterests(){
    if(!client())return;
    if(loading)return loading;
    loading=(async()=>{
      try{
        const [catalog,rows]=await Promise.all([client().rpc("get_catalog_products"),readAll()]);
        if(catalog.error)throw catalog.error;
        products=new Map((catalog.data||[]).map(product=>[product.id,product]));interests=rows;
        renderBadges();renderSummary();renderFilters();renderList();
      }catch(error){
        console.error("Lista de espera",error?.code);
        const el=document.querySelector("#waitlistList");
        if(el){el.innerHTML='<div class="empty">Não consegui carregar a lista de espera. <button class="secondary mini-order" type="button" id="retryWaitlist">Tentar novamente</button></div>';document.querySelector("#retryWaitlist").onclick=fetchInterests}
      }
    })();
    try{await loading}finally{loading=null}
  }
  async function saveStatus(id,button){
    const status=document.querySelector('[data-interest-status="'+id+'"]')?.value;if(!status)return;
    button.disabled=true;button.textContent="Salvando...";
    try{
      const {error}=await client().rpc("update_catalog_interest_status",{p_interest_id:id,p_status:status});
      if(error)throw error;
      await fetchInterests();toast("Status do interesse atualizado.");
    }catch(error){
      toast(error?.code==="23505"?"Este cliente já tem outro interesse em aberto para o produto.":"Não consegui salvar o status. Tente novamente.");
    }finally{button.disabled=false;button.textContent="Salvar"}
  }
  window.renderWaitlist=fetchInterests;
  window.initWaitlist=async function(){
    if(initialized||!client())return;initialized=true;
    document.querySelector("#waitlistSearch")?.addEventListener("input",event=>{query=event.target.value.trim().toLowerCase();renderList()});
    document.querySelector("#refreshWaitlist")?.addEventListener("click",fetchInterests);
    await fetchInterests();
    client().channel("catalog-waitlist-admin")
      .on("postgres_changes",{event:"*",schema:"public",table:"catalog_waitlist"},payload=>{
        if(payload.eventType==="INSERT")toast("Novo interesse na lista de espera.");fetchInterests();
      }).subscribe();
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")fetchInterests()});
    window.addEventListener("online",fetchInterests);
    setInterval(()=>{if(document.visibilityState==="visible")fetchInterests()},30000);
  };
})();
