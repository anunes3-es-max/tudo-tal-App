"use strict";

(function(){
  const PERIODS={
    day:{count:14,label:"Diário"},
    week:{count:12,label:"Semanal"},
    month:{count:12,label:"Mensal"},
    year:{count:5,label:"Anual"}
  };
  let currentPeriod="month";
  const sum=(arr,fn)=>arr.reduce((a,x)=>a+Number(fn(x)||0),0);
  const pct=(value,total)=>total>0?Math.round(value/total*100):0;
  const dayMs=86400000;

  function startOfPeriod(date,mode){
    const d=new Date(date);
    d.setHours(0,0,0,0);
    if(mode==="week"){
      const dow=(d.getDay()+6)%7;
      d.setDate(d.getDate()-dow);
    }else if(mode==="month"){
      d.setDate(1);
    }else if(mode==="year"){
      d.setMonth(0,1);
    }
    return d;
  }

  function addPeriod(date,mode,amount){
    const d=new Date(date);
    if(mode==="day")d.setDate(d.getDate()+amount);
    else if(mode==="week")d.setDate(d.getDate()+7*amount);
    else if(mode==="month")d.setMonth(d.getMonth()+amount);
    else d.setFullYear(d.getFullYear()+amount);
    return d;
  }

  function bucketLabel(start,mode){
    if(mode==="day")return start.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"});
    if(mode==="week"){
      const end=new Date(start);end.setDate(end.getDate()+6);
      return start.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})+"–"+end.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"});
    }
    if(mode==="month")return start.toLocaleDateString("pt-BR",{month:"short",year:"2-digit"}).replace(".","");
    return String(start.getFullYear());
  }

  function buildBuckets(mode){
    const cfg=PERIODS[mode]||PERIODS.month;
    const nowStart=startOfPeriod(new Date(),mode);
    const buckets=[];
    for(let i=cfg.count-1;i>=0;i--){
      const start=addPeriod(nowStart,mode,-i);
      const end=addPeriod(start,mode,1);
      const sales=state.sales.filter(s=>{
        const t=Date.parse(s.date);
        return Number.isFinite(t)&&t>=start.getTime()&&t<end.getTime();
      });
      buckets.push({
        start:start,end:end,label:bucketLabel(start,mode),sales:sales,
        revenue:sum(sales,s=>s.total),
        qty:sum(sales,s=>s.qty),
        result:sum(sales,s=>s.result),
        transactions:sales.length
      });
    }
    return buckets;
  }

  function variation(current,previous){
    if(previous===0)return current===0?{text:"0%",cls:"neutral"}:{text:"+100%",cls:"up"};
    const v=((current-previous)/Math.abs(previous))*100;
    return {text:(v>=0?"+":"")+Math.round(v)+"%",cls:v>0?"up":v<0?"down":"neutral"};
  }

  function renderKpis(buckets,mode){
    const current=buckets[buckets.length-1]||{revenue:0,qty:0,result:0,transactions:0};
    const previous=buckets[buckets.length-2]||{revenue:0};
    const v=variation(current.revenue,previous.revenue);
    const ticket=current.transactions?current.revenue/current.transactions:0;
    const title=(PERIODS[mode]||PERIODS.month).label;
    const rows=[
      ["Faturamento",money(current.revenue),'<span class="analytics-delta '+v.cls+'">'+v.text+' vs. período anterior</span>'],
      ["Unidades vendidas",String(current.qty),'<span class="analytics-sub">'+title+'</span>'],
      ["Ticket médio",money(ticket),'<span class="analytics-sub">'+current.transactions+' venda(s)</span>'],
      ["Resultado da loja",money(current.result),'<span class="analytics-sub">Comissão/lucro estimado</span>']
    ];
    $("#analyticsKpis").innerHTML=rows.map(r=>'<div class="analytics-kpi"><span>'+r[0]+'</span><strong>'+r[1]+'</strong>'+r[2]+'</div>').join("");
  }

  function renderTrendChart(buckets){
    const el=$("#salesTrendChart");
    if(!el)return;
    const w=920,h=320,left=48,right=16,top=22,bottom=58;
    const chartW=w-left-right,chartH=h-top-bottom;
    const max=Math.max(1,...buckets.map(b=>b.revenue));
    const step=chartW/Math.max(1,buckets.length);
    const barW=Math.max(12,Math.min(46,step*.62));
    let grid="";
    for(let i=0;i<=4;i++){
      const y=top+chartH*(i/4);
      const val=max*(1-i/4);
      const label=val>=1000?(val/1000).toFixed(val>=10000?0:1)+"k":String(Math.round(val));
      grid+='<line x1="'+left+'" x2="'+(w-right)+'" y1="'+y+'" y2="'+y+'" stroke="currentColor" opacity=".08"/><text x="'+(left-8)+'" y="'+(y+4)+'" text-anchor="end" font-size="10" fill="currentColor" opacity=".55">'+label+'</text>';
    }
    const bars=buckets.map((b,i)=>{
      const x=left+i*step+(step-barW)/2;
      const bh=Math.max(b.revenue>0?3:0,(b.revenue/max)*chartH);
      const y=top+chartH-bh;
      const labelX=left+i*step+step/2;
      return '<g><title>'+esc(b.label)+': '+esc(money(b.revenue))+' • '+b.qty+' un.</title><rect x="'+x+'" y="'+y+'" width="'+barW+'" height="'+bh+'" rx="7" class="analytics-bar"/><text x="'+labelX+'" y="'+(h-30)+'" text-anchor="middle" font-size="10" fill="currentColor" opacity=".66">'+esc(b.label)+'</text></g>';
    }).join("");
    el.innerHTML='<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Gráfico de faturamento por período">'+grid+bars+'</svg>';
  }

  function aggregate(rows,keyFn,valueFn){
    const fn=valueFn||((s)=>Number(s.qty||0));
    const map=new Map();
    for(const row of rows){
      const key=keyFn(row)||"Não informado";
      const current=map.get(key)||{label:key,value:0,revenue:0,count:0};
      current.value+=Number(fn(row)||0);
      current.revenue+=Number(row.total||0);
      current.count++;
      map.set(key,current);
    }
    return [...map.values()].sort((a,b)=>b.value-a.value||b.revenue-a.revenue);
  }

  function productMeta(s){
    const p=state.products.find(p=>p.id===s.productId||String(p.sku).toUpperCase()===String(s.sku).toUpperCase());
    return {
      category:s.productCategory||p?.category||"Não informado",
      brand:s.productBrand||p?.brand||"Sem marca"
    };
  }

  function labelCustomerType(v){
    return {novo:"Cliente novo",recorrente:"Cliente recorrente",nao_informado:"Não informado"}[v]||v||"Não informado";
  }

  function labelPurchaseProfile(v){
    return {uso_proprio:"Uso próprio",presente:"Presente",revenda:"Revenda",outro:"Outro",nao_informado:"Não informado"}[v]||v||"Não informado";
  }

  function renderBars(containerId,rows,options){
    const opts=options||{};
    const el=$(containerId);
    if(!el)return;
    const list=rows.slice(0,opts.maxItems||7);
    if(!list.length){
      el.innerHTML='<div class="empty">'+(opts.empty||"Ainda não há dados suficientes.")+'</div>';
      return;
    }
    const max=Math.max(1,...list.map(x=>x.value));
    el.innerHTML=list.map((x,i)=>{
      const value=opts.moneyValue?money(x.value):String(x.value);
      const note=x.revenue?'<div class="rank-note">'+money(x.revenue)+' em vendas</div>':"";
      return '<div class="rank-row"><div class="rank-head"><span><b>'+(i+1)+'.</b> '+esc(x.label)+'</span><strong>'+value+'</strong></div><div class="rank-track"><span style="width:'+Math.max(3,Math.round(x.value/max*100))+'%"></span></div>'+note+'</div>';
    }).join("");
  }

  function renderMarketInsights(){
    const cutoff=Date.now()-90*dayMs;
    const rows=state.sales.filter(s=>Date.parse(s.date)>=cutoff);
    const productRows=aggregate(rows,s=>s.productName||s.sku);
    const categoryRows=aggregate(rows,s=>productMeta(s).category);
    const channelRows=aggregate(rows,s=>s.channel||"Não informado",s=>Number(s.total||0));
    const customerRows=aggregate(rows,s=>labelCustomerType(s.customerType),s=>Number(s.total||0));
    const profileRows=aggregate(rows,s=>labelPurchaseProfile(s.purchaseProfile),s=>Number(s.total||0));\n    const paymentRows=aggregate(rows,s=>s.payment||"Não informado",s=>Number(s.total||0));

    renderBars("#topProducts",productRows,{maxItems:6});
    renderBars("#topCategories",categoryRows,{maxItems:6});
    renderBars("#topChannels",channelRows,{moneyValue:true,maxItems:6});
    renderBars("#customerTypes",customerRows,{moneyValue:true,maxItems:5});
    renderBars("#purchaseProfiles",profileRows,{moneyValue:true,maxItems:5});\n    renderBars("#paymentMethods",paymentRows,{moneyValue:true,maxItems:8});

    const totalRevenue=sum(rows,s=>s.total);
    const recurringRevenue=sum(rows,s=>s.customerType==="recorrente"?s.total:0);
    const topCategory=categoryRows[0];
    const topProduct=productRows[0];
    const recurringPct=pct(recurringRevenue,totalRevenue);
    const summary=[];

    if(topCategory)summary.push('Categoria com maior giro em 90 dias: <strong>'+esc(topCategory.label)+'</strong> ('+topCategory.value+' un.).');
    if(topProduct)summary.push('Produto com maior saída: <strong>'+esc(topProduct.label)+'</strong> ('+topProduct.value+' un.).');
    if(totalRevenue>0)summary.push('Clientes recorrentes representam <strong>'+recurringPct+'%</strong> do faturamento identificado no período.');

    $("#marketSummary").innerHTML=summary.length
      ?summary.map(x=>'<div class="insight-chip">'+x+'</div>').join("")
      :'<div class="empty">Comece a registrar vendas para gerar inteligência de compra.</div>';
  }

  function renderInventoryAdvice(){
    const el=$("#inventoryAdvice");
    if(!el)return;
    const cutoff90=Date.now()-90*dayMs;
    const cutoff60=Date.now()-60*dayMs;
    const rows90=state.sales.filter(s=>Date.parse(s.date)>=cutoff90);

    const items=state.products.filter(p=>p.active!==false).map(p=>{
      const related90=rows90.filter(s=>s.productId===p.id||String(s.sku).toUpperCase()===String(p.sku).toUpperCase());
      const all=state.sales.filter(s=>s.productId===p.id||String(s.sku).toUpperCase()===String(p.sku).toUpperCase());
      const sold90=sum(related90,s=>s.qty);
      const daily=sold90/90;
      const qty=Number(p.qty||0);
      const cover=daily>0?qty/daily:Infinity;
      const lastSale=all.length?Math.max(...all.map(s=>Date.parse(s.date)||0)):0;
      const created=Date.parse(p.createdAt||"");
      const ageDays=Number.isFinite(created)?Math.max(0,(Date.now()-created)/dayMs):0;
      let priority=99,status="",note="";

      if(qty===0&&sold90>0){
        priority=0;status="Sem estoque";note="Vendeu "+sold90+" un. nos últimos 90 dias.";
      }else if(sold90>=2&&cover<=21){
        priority=1;status="Repor em breve";note="Vendeu "+sold90+" un. em 90 dias • cobertura estimada ~"+Math.max(0,Math.round(cover))+" dias.";
      }else if(sold90>0&&cover<=45){
        priority=2;status="Acompanhar";note="Vendeu "+sold90+" un. em 90 dias • estoque atual "+qty+".";
      }else if(qty>0&&sold90===0&&ageDays>=60&&(lastSale===0||lastSale<cutoff60)){
        priority=3;status="Baixo giro";note="Estoque "+qty+" un. • sem venda nos últimos 60 dias.";
      }
      return {p:p,priority:priority,status:status,note:note,sold90:sold90};
    }).filter(x=>x.priority<99).sort((a,b)=>a.priority-b.priority||b.sold90-a.sold90).slice(0,10);

    if(!items.length){
      el.innerHTML='<div class="empty">Ainda não há histórico suficiente para recomendar reposição ou apontar baixo giro.</div>';
      return;
    }

    el.innerHTML=items.map(x=>{
      const cls=x.priority<=1?"urgent":x.priority===3?"slow":"";
      return '<div class="inventory-advice '+cls+'"><div><strong>'+esc(x.p.name)+'</strong><div class="meta">'+esc(x.p.category)+' • '+esc(x.p.sku)+'</div><div class="meta">'+esc(x.note)+'</div></div><span class="advice-badge">'+esc(x.status)+'</span></div>';
    }).join("");
  }

  async function renderVipReceivables(){
    const listEl=$("#vipReceivables");
    const summaryEl=$("#vipReceivableSummary");
    if(!listEl||!summaryEl)return;
    if(!window.tudoTalCloud?.fetchReceivables){
      summaryEl.innerHTML='<span class="analytics-sub">Atualize o app para carregar o Crediário VIP.</span>';
      return;
    }
    try{
      const rows=await window.tudoTalCloud.fetchReceivables();
      const pending=rows.filter(r=>r.status==="Pendente");
      const paid=rows.filter(r=>r.status==="Pago");
      const pendingTotal=pending.reduce((s,r)=>s+Number(r.amount||0),0);
      const today=new Date();today.setHours(0,0,0,0);
      const overdue=pending.filter(r=>Date.parse(r.due_date+"T00:00:00")<today.getTime());
      summaryEl.innerHTML='<div class="receivable-summary-card"><span>A receber</span><strong>'+money(pendingTotal)+'</strong><small>'+pending.length+' parcela(s) pendente(s) • '+overdue.length+' vencida(s)</small></div><div class="receivable-summary-card"><span>Parcelas recebidas</span><strong>'+paid.length+'</strong><small>Histórico do Crediário VIP</small></div>';

      if(!pending.length){
        listEl.innerHTML='<div class="empty">Nenhuma parcela pendente no Crediário VIP.</div>';
        return;
      }

      listEl.innerHTML=pending.map(r=>{
        const sale=state.sales.find(s=>s.id===r.sale_id);
        const due=new Date(r.due_date+"T00:00:00");
        const isOverdue=due.getTime()<today.getTime();
        return '<div class="receivable-row '+(isOverdue?'overdue':'')+'"><div><strong>'+esc(sale?.productName||"Venda VIP")+'</strong><div class="meta">Parcela '+r.installment_number+'/'+r.installment_count+' • vence '+due.toLocaleDateString("pt-BR")+(isOverdue?' • VENCIDA':'')+'</div><div class="meta">'+esc(sale?.owner||"")+'</div></div><div class="receivable-actions"><strong>'+money(r.amount)+'</strong><button class="mini" onclick="markVipInstallmentPaid(\''+r.id+'\')">Receber parcela</button></div></div>';
      }).join("");
    }catch(err){
      console.error("Crediário VIP",err);
      summaryEl.innerHTML='<span class="analytics-sub">Não consegui carregar o Crediário VIP agora.</span>';
      listEl.innerHTML='<div class="empty">Tente sincronizar novamente.</div>';
    }
  }

  window.markVipInstallmentPaid=async function(id){
    if(!confirm("Confirmar que esta parcela do Crediário VIP foi recebida?"))return;
    try{
      await window.tudoTalCloud.markReceivablePaid(id);
      await loadState();
      toast("Parcela recebida e atualizada na nuvem.");
      renderMarketInsights();
      renderVipReceivables();
    }catch(err){
      console.error("Receber parcela VIP",err);
      toast("Não consegui marcar a parcela como recebida.");
    }
  };

  function bindControls(){
    $$(".analytics-period button").forEach(btn=>{
      if(btn.dataset.bound)return;
      btn.dataset.bound="1";
      btn.addEventListener("click",()=>{
        currentPeriod=btn.dataset.period||"month";
        renderAnalytics(currentPeriod);
      });
    });
  }

  window.renderAnalytics=function(period){
    currentPeriod=period||currentPeriod;
    bindControls();
    $$(".analytics-period button").forEach(b=>b.classList.toggle("active",b.dataset.period===currentPeriod));
    const buckets=buildBuckets(currentPeriod);
    renderKpis(buckets,currentPeriod);
    renderTrendChart(buckets);
    renderMarketInsights();
    renderInventoryAdvice();
    const note=$("#analyticsPeriodNote");
    if(note)note.textContent={
      day:"Últimos 14 dias",
      week:"Últimas 12 semanas",
      month:"Últimos 12 meses",
      year:"Últimos 5 anos"
    }[currentPeriod]||"";
  };
})();
