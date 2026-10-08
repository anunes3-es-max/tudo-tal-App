"use strict";

(function(){
  const TABLES={products:"products",sales:"sales",cash:"cash"};
  let syncing=false;
  let lastStatus="";

  function client(){return window.tudoTalSupabase||null}
  function status(message,type="info"){
    lastStatus=message;
    const el=document.querySelector("#cloudStatus");
    if(el){el.textContent=message;el.dataset.type=type}
  }
  function stamp(store,o){
    const raw=store==="products"?(o.updatedAt||o.createdAt):
      store==="sales"?(o.updatedAt||o.repassePaidAt||o.date):
      (o.date||o.createdAt);
    const n=Date.parse(raw||"");
    return Number.isFinite(n)?n:0;
  }
  function productToCloud(o){
    return {
      id:o.id,sku:o.sku,name:o.name,category:o.category,brand:o.brand||null,size:o.size||null,
      color:o.color||null,condition:o.condition||null,mode:o.mode,partner_id:null,
      owner_name:o.owner||"Tudo e Tal",owner_phone:o.ownerPhone||null,
      price:Number(o.price||0),qty:Number(o.qty||0),cost:Number(o.cost||0),
      stock_type:o.stockType||null,photo_url:o.photo||null,active:o.active!==false,
      created_at:o.createdAt||new Date().toISOString(),
      updated_at:o.updatedAt||o.createdAt||new Date().toISOString()
    };
  }
  function productFromCloud(r){
    return {
      id:r.id,sku:r.sku,name:r.name,category:r.category,brand:r.brand||"",size:r.size||"",
      color:r.color||"",condition:r.condition||"",mode:r.mode,owner:r.owner_name||"Tudo e Tal",
      ownerPhone:r.owner_phone||"",price:Number(r.price||0),qty:Number(r.qty||0),
      cost:Number(r.cost||0),stockType:r.stock_type||"",photo:r.photo_url||"",
      active:r.active!==false,createdAt:r.created_at,updatedAt:r.updated_at
    };
  }
  function saleToCloud(o){
    return {
      id:o.id,sale_date:o.date||new Date().toISOString(),product_id:o.productId||null,
      sku:o.sku,product_name:o.productName,qty:Number(o.qty||0),unit_price:Number(o.unitPrice||0),
      total:Number(o.total||0),commission_rate:Number(o.commissionRate||0),
      commission:Number(o.commission||0),repasse:Number(o.repasse||0),mode:o.mode,
      partner_id:null,owner_name:o.owner||"Tudo e Tal",owner_phone:o.ownerPhone||null,
      payment:o.payment||null,channel:o.channel||null,received_status:o.receivedStatus||"Recebido",
      repasse_status:o.repasseStatus||"Não aplicável",repasse_paid_at:o.repassePaidAt||null,
      cost_total:Number(o.costTotal||0),result:Number(o.result||0),
      created_at:o.date||new Date().toISOString(),
      updated_at:o.updatedAt||o.repassePaidAt||o.date||new Date().toISOString()
    };
  }
  function saleFromCloud(r){
    return {
      id:r.id,date:r.sale_date,sku:r.sku,productId:r.product_id||"",productName:r.product_name,
      qty:Number(r.qty||0),unitPrice:Number(r.unit_price||0),total:Number(r.total||0),
      commissionRate:Number(r.commission_rate||0),commission:Number(r.commission||0),
      repasse:Number(r.repasse||0),mode:r.mode,owner:r.owner_name||"Tudo e Tal",
      ownerPhone:r.owner_phone||"",payment:r.payment||"",channel:r.channel||"",
      receivedStatus:r.received_status||"Recebido",repasseStatus:r.repasse_status||"Não aplicável",
      repassePaidAt:r.repasse_paid_at||null,costTotal:Number(r.cost_total||0),
      result:Number(r.result||0),updatedAt:r.updated_at
    };
  }
  function cashToCloud(o){
    return {
      id:o.id,movement_date:o.date||new Date().toISOString(),type:o.type,
      value:Number(o.value||0),description:o.description,
      created_at:o.date||new Date().toISOString()
    };
  }
  function cashFromCloud(r){
    return {id:r.id,date:r.movement_date,type:r.type,value:Number(r.value||0),description:r.description};
  }
  function toCloud(store,o){
    if(store==="products")return productToCloud(o);
    if(store==="sales")return saleToCloud(o);
    if(store==="cash")return cashToCloud(o);
    return null;
  }
  function fromCloud(store,r){
    if(store==="products")return productFromCloud(r);
    if(store==="sales")return saleFromCloud(r);
    if(store==="cash")return cashFromCloud(r);
    return null;
  }
  function merge(store,localRows,remoteRows){
    const map=new Map();
    for(const r of remoteRows)map.set(r.id,r);
    for(const l of localRows){
      const current=map.get(l.id);
      if(!current||stamp(store,l)>stamp(store,current))map.set(l.id,l);
    }
    return [...map.values()];
  }
  async function fetchRemote(store){
    const c=client();
    if(!c)throw new Error("Supabase não disponível");
    const {data,error}=await c.from(TABLES[store]).select("*");
    if(error)throw error;
    return (data||[]).map(r=>fromCloud(store,r));
  }
  async function upsertBatch(store,rows){
    if(!rows.length)return;
    const c=client();
    const sizes=store==="products"?8:50;
    for(let i=0;i<rows.length;i+=sizes){
      const payload=rows.slice(i,i+sizes).map(x=>toCloud(store,x));
      const {error}=await c.from(TABLES[store]).upsert(payload,{onConflict:"id"});
      if(error)throw error;
    }
  }
  async function upsert(store,obj){
    if(!TABLES[store]||!client()||navigator.onLine===false)return false;
    try{
      await upsertBatch(store,[obj]);
      status("☁️ Sincronizado com a nuvem • "+new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),"success");
      return true;
    }catch(err){
      console.error("Tudo & Tal cloud upsert",err);
      status("⚠️ Salvo neste aparelho. Aguardando sincronização com a nuvem.","wait");
      return false;
    }
  }
  async function syncAll(){
    if(syncing)return false;
    if(!client()){status("Nuvem indisponível nesta sessão.","error");return false}
    if(navigator.onLine===false){status("Sem internet. Seus dados continuam salvos neste aparelho.","wait");return false}
    syncing=true;
    status("☁️ Sincronizando dados...","info");
    try{
      for(const storeName of ["products","sales","cash"]){
        const [localRows,remoteRows]=await Promise.all([dbAll(storeName),fetchRemote(storeName)]);
        const merged=merge(storeName,localRows,remoteRows);
        await upsertBatch(storeName,merged);
        window.__TDT_CLOUD_APPLYING__=true;
        try{
          for(const row of merged)await localPut(storeName,row);
        }finally{window.__TDT_CLOUD_APPLYING__=false}
      }
      status("☁️ Tudo sincronizado • "+new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),"success");
      return true;
    }catch(err){
      console.error("Tudo & Tal cloud sync",err);
      status("⚠️ Não consegui sincronizar agora. Os dados locais foram preservados.","error");
      return false;
    }finally{syncing=false}
  }
  async function replaceAllFromLocal(){
    const c=client();
    if(!c||navigator.onLine===false){status("Backup restaurado localmente. Conecte à internet para enviar à nuvem.","wait");return false}
    syncing=true;
    status("☁️ Atualizando a nuvem com o backup restaurado...","info");
    try{
      for(const table of ["sales","cash","products"]){
        const {error}=await c.from(table).delete().not("id","is",null);
        if(error)throw error;
      }
      for(const storeName of ["products","sales","cash"]){
        await upsertBatch(storeName,await dbAll(storeName));
      }
      status("☁️ Backup restaurado e sincronizado com a nuvem.","success");
      return true;
    }catch(err){
      console.error("Tudo & Tal cloud restore",err);
      status("⚠️ Backup restaurado localmente, mas a nuvem ainda precisa sincronizar.","error");
      return false;
    }finally{syncing=false}
  }
  async function syncAndRefresh(){
    const ok=await syncAll();
    if(ok){
      await loadState();
      renderDashboard();
      renderProducts();
      renderLabelOptions();
      renderCash();
      if(typeof renderRepasses==="function")renderRepasses();
    }
    return ok;
  }

  window.tudoTalCloud={syncAll,syncAndRefresh,upsert,replaceAllFromLocal,status,get lastStatus(){return lastStatus}};
})();
