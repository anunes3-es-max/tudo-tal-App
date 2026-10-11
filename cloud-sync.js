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
      price:Number(o.price||0),discount_percent:Number(o.discountPercent||0),qty:Number(o.qty||0),cost:Number(o.cost||0),
      stock_type:o.stockType||null,photo_url:o.photo||null,active:o.active!==false,
      created_at:o.createdAt||new Date().toISOString(),
      updated_at:o.updatedAt||o.createdAt||new Date().toISOString()
    };
  }
  function productFromCloud(r){
    return {
      id:r.id,sku:r.sku,name:r.name,category:r.category,brand:r.brand||"",size:r.size||"",
      color:r.color||"",condition:r.condition||"",mode:r.mode,owner:r.owner_name||"Tudo e Tal",
      ownerPhone:r.owner_phone||"",price:Number(r.price||0),discountPercent:Number(r.discount_percent||0),qty:Number(r.qty||0),
      cost:Number(r.cost||0),stockType:r.stock_type||"",photo:r.photo_url||"",
      active:r.active!==false,createdAt:r.created_at,updatedAt:r.updated_at
    };
  }
  function saleToCloud(o){
    return {
      id:o.id,sale_date:o.date||new Date().toISOString(),product_id:o.productId||null,
      sku:o.sku,product_name:o.productName,product_category:o.productCategory||null,product_brand:o.productBrand||null,qty:Number(o.qty||0),unit_price:Number(o.unitPrice||0),list_unit_price:Number((o.listUnitPrice??o.unitPrice)||0),
      total:Number(o.total||0),discount_percent:Number(o.discountPercent||0),discount_amount:Number(o.discountAmount||0),promotion_discount_percent:Number(o.promotionDiscountPercent||0),checkout_discount_percent:Number(o.checkoutDiscountPercent||0),cart_id:o.cartId||null,commission_rate:Number(o.commissionRate||0),
      commission:Number(o.commission||0),repasse:Number(o.repasse||0),mode:o.mode,
      partner_id:null,owner_name:o.owner||"Tudo e Tal",owner_phone:o.ownerPhone||null,
      payment:o.payment||null,payment_provider:o.paymentProvider||null,card_brand:o.cardBrand||null,receiving_plan:o.receivingPlan||null,rate_tier:o.rateTier||null,processing_fee_rate:Number(o.processingFeeRate||0),processing_fee_amount:Number(o.processingFeeAmount||0),net_amount:Number(o.netAmount??o.total??0),installments:Number(o.installments||1),first_due_date:o.firstDueDate||null,channel:o.channel||null,customer_type:o.customerType||"nao_informado",purchase_profile:o.purchaseProfile||"nao_informado",received_status:o.receivedStatus||"Recebido",
      repasse_status:o.repasseStatus||"Não aplicável",repasse_paid_at:o.repassePaidAt||null,
      cost_total:Number(o.costTotal||0),result:Number(o.result||0),
      created_at:o.date||new Date().toISOString(),
      updated_at:o.updatedAt||o.repassePaidAt||o.date||new Date().toISOString()
    };
  }
  function saleFromCloud(r){
    return {
      id:r.id,date:r.sale_date,sku:r.sku,productId:r.product_id||"",productName:r.product_name,
      productCategory:r.product_category||"",productBrand:r.product_brand||"",qty:Number(r.qty||0),unitPrice:Number(r.unit_price||0),listUnitPrice:Number((r.list_unit_price??r.unit_price)||0),total:Number(r.total||0),discountPercent:Number(r.discount_percent||0),discountAmount:Number(r.discount_amount||0),promotionDiscountPercent:Number(r.promotion_discount_percent||0),checkoutDiscountPercent:Number(r.checkout_discount_percent||0),cartId:r.cart_id||"",
      commissionRate:Number(r.commission_rate||0),commission:Number(r.commission||0),
      repasse:Number(r.repasse||0),mode:r.mode,owner:r.owner_name||"Tudo e Tal",
      ownerPhone:r.owner_phone||"",payment:r.payment||"",paymentProvider:r.payment_provider||"",cardBrand:r.card_brand||"",receivingPlan:r.receiving_plan||"",rateTier:r.rate_tier||"",processingFeeRate:Number(r.processing_fee_rate||0),processingFeeAmount:Number(r.processing_fee_amount||0),netAmount:Number(r.net_amount??r.total??0),installments:Number(r.installments||1),firstDueDate:r.first_due_date||null,channel:r.channel||"",
      customerType:r.customer_type||"nao_informado",purchaseProfile:r.purchase_profile||"nao_informado",
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

  function mergeProducts(localRows,remoteRows){
    const remoteBySku=new Map();
    const mergedById=new Map();
    const idMap=new Map();

    for(const r of remoteRows){
      remoteBySku.set(String(r.sku||"").toUpperCase(),r);
      mergedById.set(r.id,r);
    }

    for(const l of localRows){
      const sku=String(l.sku||"").toUpperCase();
      const sameSku=remoteBySku.get(sku);
      if(sameSku){
        idMap.set(l.id,sameSku.id);
        const newer=stamp("products",l)>stamp("products",sameSku)?l:sameSku;
        mergedById.set(sameSku.id,{
          ...newer,
          id:sameSku.id,
          sku:sameSku.sku,
          // Estoque é sempre soberano na nuvem. Vendas e reservas atualizam
          // a quantidade no servidor; um cache local antigo nunca pode repor
          // unidades que já saíram.
          qty:Number(sameSku.qty||0),
          createdAt:sameSku.createdAt||newer.createdAt,
          updatedAt:sameSku.updatedAt||newer.updatedAt
        });
        continue;
      }

      const sameId=mergedById.get(l.id);
      if(!sameId||stamp("products",l)>stamp("products",sameId))mergedById.set(l.id,l);
      idMap.set(l.id,l.id);
    }

    return {rows:[...mergedById.values()],idMap};
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
      if(store==="sales"){
        // Vendas novas só podem nascer pelos RPCs atômicos do PDV.
        // Alterações em vendas já existentes (ex.: repasse pago) usam UPDATE,
        // evitando que caches antigos recriem vendas apagadas.
        const payload=toCloud(store,obj);
        const {error}=await client().from(TABLES[store]).update(payload).eq("id",obj.id);
        if(error)throw error;
      }else{
        await upsertBatch(store,[obj]);
      }
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
      const [localProducts,remoteProducts]=await Promise.all([dbAll("products"),fetchRemote("products")]);
      const productMerge=mergeProducts(localProducts,remoteProducts);
      await upsertBatch("products",productMerge.rows);

      // Depois de enviar eventuais alterações de cadastro, baixa novamente
      // o estoque do servidor e usa essa cópia como verdade local.
      // Assim o painel nunca fica preso em quantidade antiga do IndexedDB.
      const authoritativeProducts=await fetchRemote("products");
      window.__TDT_CLOUD_APPLYING__=true;
      try{
        await dbClear("products");
        for(const row of authoritativeProducts)await localPut("products",row);
      }finally{window.__TDT_CLOUD_APPLYING__=false}

      for(const storeName of ["sales","cash"]){
        const remoteRows=await fetchRemote(storeName);
        let rows;

        if(storeName==="sales"){
          // Vendas são registradas de forma atômica no servidor e a nuvem é
          // a fonte de verdade. Isso evita que um histórico apagado no servidor
          // seja recriado por um cache antigo de outro aparelho.
          rows=remoteRows;
        }else{
          const localRows=await dbAll(storeName);
          rows=merge(storeName,localRows,remoteRows);
          await upsertBatch(storeName,rows);
        }

        window.__TDT_CLOUD_APPLYING__=true;
        try{
          await dbClear(storeName);
          for(const row of rows)await localPut(storeName,row);
        }finally{window.__TDT_CLOUD_APPLYING__=false}
      }
      status("☁️ Tudo sincronizado • "+new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),"success");
      return true;
    }catch(err){
      console.error("Tudo & Tal cloud sync",err);
      const detail=String(err?.message||err||"erro desconhecido").slice(0,120);
      status("⚠️ Sincronização não concluída: "+detail,"error");
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

      await upsertBatch("products",await dbAll("products"));

      // INSERT direto em vendas fica bloqueado para impedir que cache antigo
      // recrie histórico apagado. Na restauração de backup usamos um RPC
      // administrativo dedicado, que mantém a proteção do PDV.
      for(const sale of await dbAll("sales")){
        const {error}=await c.rpc("restore_sale_backup",{p_sale:saleToCloud(sale)});
        if(error)throw error;
      }

      await upsertBatch("cash",await dbAll("cash"));
      status("☁️ Backup restaurado e sincronizado com a nuvem.","success");
      return true;
    }catch(err){
      console.error("Tudo & Tal cloud restore",err);
      status("⚠️ Backup restaurado localmente, mas a nuvem ainda precisa sincronizar.","error");
      return false;
    }finally{syncing=false}
  }
  async function registerSaleAtomic({saleId,productId,qty,unitPrice,payment,installments,firstDueDate,cardBrand,receivingPlan,rateTier,channel,customerType,purchaseProfile}){
    const c=client();
    if(!c)throw new Error("Nuvem indisponível nesta sessão.");
    if(navigator.onLine===false)throw new Error("A venda segura precisa de internet para confirmar o estoque.");

    const {data,error}=await c.rpc("register_sale_atomic",{
      p_sale_id:saleId,
      p_product_id:productId,
      p_qty:Number(qty),
      p_unit_price:Number(unitPrice),
      p_payment:payment||null,
      p_channel:channel||null,
      p_customer_type:customerType||"nao_informado",
      p_purchase_profile:purchaseProfile||"nao_informado",
      p_installments:Number(installments||1),
      p_first_due_date:firstDueDate||null,
      p_card_brand:cardBrand||null,
      p_receiving_plan:receivingPlan||"one_day",
      p_rate_tier:rateTier||"up_to_20"
    });
    if(error)throw error;
    if(!data?.sale||!data?.product)throw new Error("Resposta inválida ao registrar a venda.");

    const localProduct=productFromCloud(data.product);
    const localSale=saleFromCloud(data.sale);

    window.__TDT_CLOUD_APPLYING__=true;
    try{
      await localPut("products",localProduct);
      await localPut("sales",localSale);
    }finally{window.__TDT_CLOUD_APPLYING__=false}

    status("☁️ Venda protegida e sincronizada • "+new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),"success");
    return {status:data.status||"registered",product:localProduct,sale:localSale};
  }

  async function registerSaleCartAtomic({cartId,items,discountPercent=0,payment,installments,firstDueDate,cardBrand,receivingPlan,rateTier,channel,customerType,purchaseProfile}){
    const c=client();
    if(!c)throw new Error("Nuvem indisponível nesta sessão.");
    if(navigator.onLine===false)throw new Error("A venda segura precisa de internet para confirmar o estoque.");
    const {data,error}=await c.rpc("register_sale_cart_atomic",{
      p_cart_id:cartId,
      p_items:(items||[]).map(x=>({product_id:x.productId,qty:Number(x.qty)})),
      p_discount_percent:Number(discountPercent||0),
      p_payment:payment||null,
      p_channel:channel||"Loja física",
      p_customer_type:customerType||"nao_informado",
      p_purchase_profile:purchaseProfile||"nao_informado",
      p_installments:Number(installments||1),
      p_first_due_date:firstDueDate||null,
      p_card_brand:cardBrand||null,
      p_receiving_plan:receivingPlan||"one_day",
      p_rate_tier:rateTier||"up_to_20"
    });
    if(error)throw error;
    await syncAll();
    await loadState();
    status("☁️ Compra finalizada e estoque sincronizado • "+new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),"success");
    return data;
  }

  async function getInfinityPayRate({payment,installments=1,receivingPlan="one_day",rateTier="up_to_20",brandGroup="visa_master"}){
    const c=client();
    if(!c)throw new Error("Nuvem indisponível nesta sessão.");
    const {data,error}=await c.rpc("get_infinitypay_rate",{
      p_payment:payment,
      p_installments:Number(installments||1),
      p_receiving_plan:receivingPlan,
      p_rate_tier:rateTier,
      p_brand_group:brandGroup
    });
    if(error)throw error;
    return data;
  }

  async function fetchReceivables(){
    const c=client();
    if(!c)throw new Error("Nuvem indisponível nesta sessão.");
    const {data,error}=await c.from("receivable_installments")
      .select("*")
      .order("due_date",{ascending:true})
      .order("installment_number",{ascending:true});
    if(error)throw error;
    return data||[];
  }

  async function markReceivablePaid(receivableId){
    const c=client();
    if(!c)throw new Error("Nuvem indisponível nesta sessão.");
    const {data,error}=await c.rpc("mark_receivable_paid",{p_receivable_id:receivableId});
    if(error)throw error;
    await syncAll();
    return data;
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
      if(typeof renderAnalytics==="function"&&state.view==="analytics")renderAnalytics();
    }
    return ok;
  }

  window.tudoTalCloud={syncAll,syncAndRefresh,upsert,replaceAllFromLocal,registerSaleAtomic,registerSaleCartAtomic,getInfinityPayRate,fetchReceivables,markReceivablePaid,status,get lastStatus(){return lastStatus}};
})();
