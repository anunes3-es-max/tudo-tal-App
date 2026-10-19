/* Read-only dashboard drilldowns. Existing payment and correction flows are reused. */
(()=>{
 'use strict';
 const names=['Estoque','Valor do estoque','Vendas acumuladas','Resultado estimado das vendas','Repasses pendentes','Crediário a receber','Saldo financeiro','Dinheiro na gaveta','Cartão a confirmar'];
 const cent=v=>Math.round(Number(v||0)*100),sum=(rows,f)=>rows.reduce((n,r)=>n+cent(f(r)),0)/100;
 const date=v=>v?new Date(v.length===10?v+'T12:00:00Z':v).toLocaleDateString('pt-BR',{timeZone:'America/Fortaleza'}):'Sem data';
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza'}).format(new Date());
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 let selected=0,items=[],sequence=0;
 function row(title,meta,value,extra=''){return '<article class="detail-row"><div><strong>'+esc(title)+'</strong><p class="meta">'+esc(meta)+'</p>'+extra+'</div><strong class="detail-amount">'+value+'</strong></article>';}
 function saleMeta(s){return date(s.date)+' · '+(s.customerName||'Cliente não identificado — completar cadastro')+' · '+s.payment+' · '+s.qty+' un.';}
 function item(search,html){return{search:norm(search),html};}
 function saleFor(r){return state.sales.find(s=>s.id===r.sale_id)||state.sales.find(s=>r.cart_id&&s.cartId===r.cart_id);}
 function groupVip(rows,payments){
  const groups=new Map();
  for(const r of rows){const s=saleFor(r),name=window.customerLabel?.(s?.customerId)||s?.customerName||'Cliente não identificado — completar cadastro',phone=s?.customerPhone||'';
   // Do not merge people on name alone: no-phone customers stay separated by purchase.
   const key=s?.customerId?'customer|'+s.customerId:'purchase|'+(r.cart_id||r.sale_id||r.id);
   if(!groups.has(key))groups.set(key,{name,phone,rows:[],sales:new Map()});
   const g=groups.get(key);g.rows.push(r);for(const sale of (r.cart_id?state.sales.filter(s=>s.cartId===r.cart_id):[s].filter(Boolean)))g.sales.set(sale.id,sale);
  }
  return [...groups.values()].map(g=>{
   const pending=g.rows.filter(r=>cent(r.amount)>cent(r.paid_amount)),balance=sum(pending,r=>Number(r.amount)-Number(r.paid_amount));if(!balance)return null;
   const next=pending.map(r=>r.due_date).filter(Boolean).sort()[0],overdue=pending.some(r=>r.due_date<today());
   const history=payments.filter(p=>g.rows.some(r=>r.id===p.receivable_id));
   const first=[...g.sales.values()][0];const bought=first?.customerId?state.sales.filter(s=>s.customerId===first.customerId):[...g.sales.values()];
   const body='<details class="detail-customer"><summary><span><strong>'+esc(g.name)+'</strong><small>'+esc(g.phone||'Sem WhatsApp · compra separada')+'</small><small>'+(overdue?'Há parcela vencida · ':'')+'Próximo vencimento: '+date(next)+'</small></span><span><strong>'+money(balance)+'</strong><small>Ver compras e parcelas ›</small></span></summary><div class="detail-customer-body"><h3>Compras</h3>'+bought.map(s=>row(s.productName,date(s.date)+' · '+s.qty+' un.',money(s.total),'<button type="button" class="mini" data-fin-customer="'+esc(s.id)+'">Editar cliente</button> <button type="button" class="mini" data-fin-sale="'+esc(s.id)+'">Detalhes / corrigir compra</button>')).join('')+'<h3>Parcelas e entrada</h3>'+g.rows.map(r=>row(r.is_down_payment?'Entrada':'Parcela '+r.installment_number+'/'+r.installment_count,'Vencimento: '+date(r.due_date)+' · combinado '+money(r.amount)+' · recebido '+money(r.paid_amount),money(Math.max(0,Number(r.amount)-Number(r.paid_amount))),cent(r.amount)>cent(r.paid_amount)?'<button type="button" class="mini" data-detail-receipt="'+esc(r.id)+'">Receber valor</button>':'<span class="hint">Quitado</span>')).join('')+'<h3>Histórico de recebimentos</h3>'+(history.length?history.map(p=>row(date(p.received_at),p.payment_method,money(p.amount))).join(''):'<p class="hint">Nenhum recebimento registrado.</p>')+'</div></details>';
   return item([g.name,g.phone,...bought.map(s=>s.productName)].join(' '),body);
  }).filter(Boolean);
 }
 async function allRows(table){let result=[];for(let offset=0;;offset+=500){const {data,error}=await window.tudoTalSupabase.from(table).select('*').order('id',{ascending:true}).range(offset,offset+499);if(error)throw error;result.push(...(data||[]));if(!data||data.length<500)return result;}}
 function list(){const query=norm(document.querySelector('#detailSearch').value),shown=items.filter(x=>x.search.includes(query));document.querySelector('#detailList').innerHTML=shown.length?shown.map(x=>x.html).join(''):'<div class="empty">'+(items.length?'Nenhum resultado para esta busca.':'Nenhum registro neste detalhamento.')+'</div>';document.querySelector('#detailCount').textContent=shown.length+' de '+items.length+' registro(s) · o total acima inclui todos';}
 window.openDashboardDetail=async function(index){selected=Number(index);if(!names[selected])return;document.querySelector('#detailSearch').value='';nav('detalhes');await window.renderDashboardDetail();};
 window.renderDashboardDetail=async function(){
  if(state.view!=='detalhes')return;
  const token=++sequence,key=selected;
  const heading=document.querySelector('#detailTitle'),total=document.querySelector('#detailTotal'),note=document.querySelector('#detailNote');
  heading.textContent=names[key];total.textContent='Conferindo…';note.textContent='Todo o histórico registrado. Valores atuais após correções.';items=[];list();
  try{
   let rows=[],amount=0,expected=null;
   if(key<=1){rows=state.products.filter(p=>p.active!==false);amount=sum(rows,p=>Number(p.qty)*Number(p.price));items=rows.map(p=>item(p.name+' '+p.sku+' '+p.category,row(p.name,p.sku+' · '+p.qty+' un. × '+money(p.price),key===0?p.qty+' un.':money(Number(p.qty)*Number(p.price)))));total.textContent=key===0?rows.reduce((n,p)=>n+Number(p.qty||0),0)+' un. · '+rows.length+' produtos':money(amount);note.textContent=key===0?'Produtos ativos, incluindo os que estão com estoque zero.':'Valor de venda cadastrado × quantidade disponível. Não é o custo de compra.';}
   else if(key===2||key===3||key===4){rows=state.sales.filter(s=>key!==4||(s.mode==='consignado'&&s.repasseStatus==='Pendente')).sort((a,b)=>String(b.date).localeCompare(String(a.date)));const field=key===2?'total':key===3?'result':'repasse';amount=sum(rows,s=>s[field]);items=rows.map(s=>item([s.productName,s.customerName,s.owner,s.sku].join(' '),row(key===4?s.owner:s.productName,key===4?s.productName+' · '+date(s.date):saleMeta(s),money(s[field]),key===3?'<p class="hint">Venda '+money(s.total)+' − custos '+money(s.costTotal)+' − repasse '+money(s.repasse)+' − taxas previstas '+money(s.processingFeeAmount)+'</p>':'')));total.textContent=money(amount);if(key===3)note.textContent='Resultado estimado das vendas; não é saldo disponível no caixa.';}
   else if(key===5){
    await window.refreshCustomers?.();const data=await window.renderFlexibleVipReceivables();if(token!==sequence||state.view!=='detalhes')return;if(!data)throw Error('Não foi possível carregar as parcelas. Use Atualizar detalhes.');
    amount=sum(data.rows,r=>Math.max(0,Number(r.amount)-Number(r.paid_amount)));items=groupVip(data.rows,data.payments);expected=state.finance?.vip_pending;total.textContent=money(amount);note.textContent='Toque no cliente para ver compras, parcelas e recebimentos. Compras vinculadas ao mesmo número de cliente aparecem juntas, independentemente da data. Compras ainda sem vínculo ficam separadas.';
   }else if(key===8){
    rows=(await allRows('finance_pending')).filter(r=>r.kind==='card'&&r.status==='Pendente');if(token!==sequence||state.view!=='detalhes')return;
    amount=sum(rows,r=>Number(r.amount)-Number(r.expected_fee));expected=state.finance?.card_pending;
    items=rows.map(r=>{const s=state.sales.find(s=>s.id===r.sale_id);return item([r.description,s?.customerName,s?.productName].join(' '),row(s?.customerName||'Cliente não identificado — completar cadastro',r.description+' · '+(s?.productName||'')+' · '+date(r.created_at),money(Number(r.amount)-Number(r.expected_fee)),'<p class="hint">Bruto '+money(r.amount)+' · taxa prevista '+money(r.expected_fee)+'</p>'));});total.textContent=money(amount);note.textContent='Valor líquido previsto: bruto menos taxas. Confirme o recebimento no Caixa.';
   }else{
    rows=await allRows('finance_movements');if(token!==sequence||state.view!=='detalhes')return;if(key===7)rows=rows.filter(r=>r.method==='Dinheiro');rows.sort((a,b)=>String(b.occurred_at).localeCompare(String(a.occurred_at)));
    amount=sum(rows,r=>r.amount);expected=key===7?state.finance?.physical:state.finance?.balance;
    items=rows.map(r=>item(r.description+' '+r.method+' '+r.category,row(r.description,date(r.occurred_at)+' · '+r.method+' · '+(Number(r.amount)<0?'Saída':'Entrada'),money(r.amount))));total.textContent=money(amount);note.textContent='Entradas '+money(sum(rows.filter(r=>Number(r.amount)>0),r=>r.amount))+' − saídas '+money(-sum(rows.filter(r=>Number(r.amount)<0),r=>r.amount))+'. '+(key===7?'Somente movimentações em dinheiro.':'Todas as formas de recebimento registradas.');
   }
   if(token!==sequence||state.view!=='detalhes')return;
   if(expected!=null&&cent(amount)!==cent(expected))note.textContent+=' Os dados mudaram desde a tela inicial. Toque em Atualizar detalhes para sincronizar.';
   list();
  }catch(err){if(token===sequence){items=[];total.textContent='Não foi possível conferir';note.textContent=err.message||'Tente atualizar os dados.';document.querySelector('#detailList').innerHTML='<div class="empty">Os valores não foram carregados. Não interprete esta tela como saldo zero.</div>';}}
 };
 document.addEventListener('click',e=>{const card=e.target.closest('[data-dashboard-detail]');if(card)window.openDashboardDetail(card.dataset.dashboardDetail);const receipt=e.target.closest('[data-detail-receipt]');if(receipt)window.openVipReceipt(receipt.dataset.detailReceipt);});
 document.addEventListener('DOMContentLoaded',()=>{document.querySelector('#detailSearch').addEventListener('input',list);document.querySelector('#detailRefresh').addEventListener('click',async()=>{const ok=await window.tudoTalCloud.syncAndRefresh();if(!ok)document.querySelector('#detailNote').textContent='Não foi possível sincronizar. Confira sua conexão e entre novamente se a sessão expirou.';});});
 window.TudoTalDashboardDetails={groupVip};
})();
