"use strict";
(function(){
  const c=()=>window.tudoTalSupabase;
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const stamp=v=>new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const dayLabel=v=>String(v||'').split('-').reverse().join('/');
  const options=values=>values.map(v=>'<option>'+esc(v)+'</option>').join('');
  const methods=(known=false)=>options(known?['Pix','Dinheiro','Transferência','Outro']:['Pix','Dinheiro','Transferência','Outro','Não informado']);
  const num=(id)=>Number($(id)?.value||0);
  let report=null,request=null,authRequest=null,cashRequest=null,loading=0,historyLimit=50;

  function range(mode,anchor){
    const d=new Date(anchor+'T12:00:00Z'),first=new Date(d),last=new Date(d);
    if(mode==='week'){first.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);last.setTime(first.getTime());last.setUTCDate(first.getUTCDate()+6)}
    if(mode==='month'){first.setUTCDate(1);last.setUTCMonth(d.getUTCMonth()+1,0)}
    return [first.toISOString().slice(0,10),last.toISOString().slice(0,10)];
  }
  window.TudoTalFinanceMath={range};
  async function rpc(name,args){if(navigator.onLine===false)throw Error('Conecte à internet para confirmar esta operação.');const {data,error}=await c().rpc(name,args);if(error)throw error;return data;}
  function errorAt(el,error){el.textContent=String(error?.message||error||'Não foi possível concluir.');el.classList.add('finance-error');}
  function busy(form,value){form.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=value);}
  async function refreshAfter(){const ok=await window.tudoTalCloud.syncAndRefresh();if(!ok)toast('Operação confirmada no servidor. Atualize a tela para carregar os saldos.');window.renderSalesHistory();if(state.view==='caixa')await window.renderCash();}

  // Passwords go only to Supabase Auth. No local PIN, password storage or browser-only permission check.
  function authorize(summary){
    return new Promise((resolve,reject)=>{
      if(authRequest){reject(Error('Conclua a confirmação em andamento.'));return;}
      authRequest={resolve,reject,busy:false};$('#financeAuthSummary').textContent=summary;$('#financeAuthError').textContent='';
      $('#financePassword').value='';$('#financeAuthDialog').showModal();$('#financePassword').focus();
    });
  }
  function cancelAuth(){if(authRequest?.busy)return;const pending=authRequest;authRequest=null;$('#financePassword').value='';$('#financeAuthDialog').close();pending?.reject(Error('Operação cancelada.'));}
  async function submitAuth(e){
    e.preventDefault();if(!authRequest||authRequest.busy)return;authRequest.busy=true;busy(e.target,true);$('#financeAuthError').textContent='Conferindo acesso…';
    try{
      const {data:{user},error}=await c().auth.getUser();if(error||!user?.email)throw Error('Sua sessão expirou. Entre novamente no aplicativo.');
      const {data,error:loginError}=await c().auth.signInWithPassword({email:user.email,password:$('#financePassword').value});
      $('#financePassword').value='';if(loginError||data.user?.id!==user.id)throw Error('Não foi possível confirmar a senha dessa conta.');
      const pending=authRequest;authRequest=null;$('#financeAuthDialog').close();pending.resolve();
    }catch(err){errorAt($('#financeAuthError'),err);authRequest.busy=false;}finally{busy(e.target,false);}
  }

  window.renderCash=async function(){
    if(state.view!=='caixa'||!c())return;
    const token=++loading;const mode=$('#financePeriod').value,anchor=$('#financeDate').value||today();
    const [from,to]=range(mode,anchor);$('#financeDate').value=anchor;$('#financeStatus').classList.remove('finance-error');$('#financeStatus').textContent='Conferindo os movimentos no servidor…';
    $('#financePdf').disabled=true;$('#financeClose').disabled=true;
    try{
      const data=await rpc('finance_report',{p_from:from,p_to:to});if(token!==loading)return;report=data;
      $('#financeStatus').textContent='Atualizado em '+stamp(data.generated_at)+' · horário de Brasília';
      const cards=[['Vendas no período',data.sold],['Entradas registradas',data.inflow],['Saídas registradas',data.outflow],['Saldo financeiro',data.balance],['Dinheiro esperado na gaveta',data.cash_balance],['Crediário a receber agora',data.vip_pending]];
      $('#financeSummary').innerHTML=cards.map(([title,value])=>'<div class="card"><span>'+title+'</span><strong>'+money(value)+'</strong></div>').join('');
      $('#financeOpening').textContent='Saldo anterior ao período: '+money(data.opening)+' · dinheiro: '+money(data.cash_opening)+'. O saldo depende do saldo inicial e dos movimentos registrados.';
      $('#financeUnknown').textContent=Number(data.unknown_balance)!==0?'Há '+money(data.unknown_balance)+' de saldo com forma “Outro” ou “Não informado”. Esse valor não é contado como dinheiro físico.':'';
      $('#financeMethods').innerHTML='<h3>Por forma de movimentação</h3>'+table(['Forma','Entradas','Saídas','Variação'],data.methods.map(m=>[esc(m.method),money(m.inflow),money(m.outflow),money(m.net)]));
      const reversed=new Set(data.movements.map(m=>m.reversal_of).filter(Boolean));
      $('#cashList').innerHTML=data.movements.length?[...data.movements].reverse().map(m=>'<article class="list-item"><div class="list-main"><strong>'+esc(m.description)+'</strong><div class="meta">'+stamp(m.occurred_at)+' · '+esc(m.category)+' · '+esc(m.method)+'</div>'+(m.metadata?.record_only?'<div class="meta">Correção do registro; sem transferência feita pelo aplicativo.</div>':'')+'</div><div class="finance-row-end"><strong class="'+(Number(m.amount)<0?'finance-out':'finance-in')+'">'+money(m.amount)+'</strong>'+(m.id.startsWith('cash:')&&!reversed.has(m.id)?'<button class="mini" data-fin-reverse="'+esc(m.id)+'">Estornar lançamento</button>':'')+'</div></article>').join(''):'<div class="empty">Nenhuma entrada ou saída neste período.</div>';
      $('#financePending').innerHTML='<h3>Pendências atuais</h3><p class="hint">Cartão: confirme o líquido recebido no extrato. Devoluções e diferenças só entram no caixa quando você confirma a regularização.</p>'+(data.pending.length?data.pending.map(f=>'<article class="list-item"><div class="list-main"><strong>'+esc(f.description)+'</strong><div class="meta">'+esc(f.customer_name||f.product_name)+' · '+(f.kind==='card'?'Líquido previsto '+money(Number(f.amount)-Number(f.expected_fee)):f.kind==='owner'?'Valor a recuperar do consignante':Number(f.amount)<0?'Valor a devolver':'Valor a receber')+'</div></div><div class="finance-row-end"><strong>'+money(Math.abs(f.amount))+'</strong><button class="mini" data-fin-settle="'+f.id+'">'+(f.kind==='card'?'Confirmar recebimento':'Regularizar')+'</button></div></article>').join(''):'<p class="hint">Nenhuma diferença ou recebimento de cartão pendente.</p>');
      $('#financeClosures').innerHTML='<h3>Fechamentos do período</h3>'+(data.closures.length?data.closures.map(x=>'<article class="list-item"><div><strong>'+dayLabel(x.day)+' · versão '+x.revision+' · '+(x.reopened_at?'Reaberto':'Fechado')+'</strong><div class="meta">Conferido '+money(x.counted_cash)+' · diferença '+money(x.difference)+' · '+esc(x.actor||'Administrador')+'</div><div class="meta">'+esc(x.note)+(x.reopened_at?' · Reabertura: '+esc(x.reopen_reason):'')+'</div></div><div class="finance-row-end"><button class="mini" data-fin-close-pdf="'+x.id+'">PDF desse fechamento</button>'+(!x.reopened_at?'<button class="mini" data-fin-reopen="'+x.id+'">Reabrir dia</button>':'')+'</div></article>').join(''):'<p class="hint">Nenhum fechamento salvo. O relatório semanal e mensal consolida os movimentos, sem duplicar lançamentos.</p>');
      const active=data.closures.some(x=>x.day===from&&!x.reopened_at);$('#financeClose').disabled=mode!=='day'||from>today()||active;$('#financeClose').textContent=active?'Dia fechado':'Conferir e fechar dia';$('#financePdf').disabled=false;
    }catch(err){if(token===loading){report=null;errorAt($('#financeStatus'),err);}}
  };
  function table(head,rows){return '<div class="finance-table-wrap"><table class="finance-table"><thead><tr>'+head.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
  window.saveCash=async function(e){
    e.preventDefault();const value={type:$('#cashType').value,value:num('#cashValue'),description:$('#cashDescription').value.trim(),method:$('#cashMethod').value,category:$('#cashCategory').value};
    if(value.value<=0||value.description.length<3)return;
    const fingerprint=JSON.stringify(value);if(cashRequest?.busy)return;if(cashRequest?.fingerprint!==fingerprint)cashRequest={id:crypto.randomUUID(),fingerprint};cashRequest.busy=true;busy(e.target,true);
    try{await authorize((value.type==='entrada'?'Registrar entrada de ':'Registrar saída de ')+money(value.value)+' · '+value.description);await rpc('save_cash',{p_cash:{...value,id:cashRequest.id}});cashRequest=null;e.target.reset();toast('Movimento confirmado no caixa.');await refreshAfter();}
    catch(err){errorAt($('#financeStatus'),err);}finally{if(cashRequest)cashRequest.busy=false;busy(e.target,false);}
  };

  window.renderSalesHistory=function(){
    const host=$('#salesHistoryList');if(!host)return;
    const query=($('#salesHistorySearch')?.value||'').toLocaleLowerCase('pt-BR'),status=$('#salesHistoryStatus').value;
    const rows=[...state.sales].filter(s=>(status==='Todas'||(s.status||'Ativa')===status)&&[s.productName,s.sku,s.customerName,s.id,s.cartId].join(' ').toLocaleLowerCase('pt-BR').includes(query)).sort((a,b)=>b.date.localeCompare(a.date));
    $('#salesHistoryCount').textContent=rows.length+' item(ns) de venda · valores atuais após correções';
    host.innerHTML=rows.length?rows.slice(0,historyLimit).map(s=>'<article class="list-item"><div class="list-main"><strong>'+esc(s.productName)+'</strong><div class="meta">'+stamp(s.date)+' · '+esc(s.sku)+' · '+esc(s.payment)+'</div><div class="meta">'+esc(s.customerName||'Cliente não informado')+' · '+s.qty+' un. · '+esc(s.status||'Ativa')+(s.revision?' · '+s.revision+' correção(ões)':'')+'</div></div><div class="finance-row-end"><strong>'+money(s.total)+'</strong><button class="mini" data-fin-sale="'+esc(s.id)+'">Detalhes / corrigir</button></div></article>').join(''):'<div class="empty">Nenhuma venda encontrada.</div>';
    $('#salesHistoryMore').hidden=rows.length<=historyLimit;
  };
  function openAction(title,body,kind,data){
    if(request?.busy)return;request={id:crypto.randomUUID(),kind,data,busy:false};$('#financeActionTitle').textContent=title;$('#financeActionBody').innerHTML=body;$('#financeActionError').textContent='';$('#financeActionSave').hidden=false;$('#financeActionDialog').showModal();
  }
  function reason(){return '<label>Motivo / observação<textarea id="financeReason" class="input" required minlength="5" maxlength="500" placeholder="Explique o que aconteceu"></textarea></label>';}
  function closeAction(){if(request?.busy)return;request=null;$('#financeActionDialog').close();}
  async function openSale(id){
    const s=state.sales.find(x=>x.id===id);if(!s)return;
    openAction('Venda · '+s.productName,'<p>'+esc(s.sku)+' · '+stamp(s.date)+' · '+esc(s.payment)+'</p><p>Original: <strong>'+money(s.originalData?.total??s.total)+'</strong> · atual: <strong>'+money(s.total)+'</strong> · '+s.qty+' un.</p><div id="saleAudit" class="hint">Carregando histórico…</div>'+(s.status==='Cancelada'?'<p>Este item foi cancelado. As devoluções pendentes ficam no Caixa.</p>':'<label>O que deseja corrigir?<select id="financeSaleAction" class="input"><option value="price">Corrigir preço</option><option value="return">Devolver parte dos itens</option><option value="cancel">Cancelar este item de venda</option><option value="exchange">Trocar por outro produto</option></select></label><div id="financeSaleFields"></div>'+reason()+'<div id="financeSalePreview" class="finance-notice"></div>'), 'sale',s);
    $('#financeActionSave').hidden=s.status==='Cancelada';if(s.status!=='Cancelada'){saleFields();$('#financeSaleAction').addEventListener('change',saleFields);}
    const {data,error}=await c().from('finance_events').select('*').eq('sale_id',id).order('occurred_at',{ascending:true});
    if(request?.kind!=='sale'||request.data.id!==id)return;
    $('#saleAudit').innerHTML=error?'Não consegui carregar a auditoria. Atualize antes de corrigir.':'<details><summary>Histórico registrado ('+data.length+')</summary>'+data.map(x=>'<p><strong>'+esc(x.action)+'</strong> · '+stamp(x.occurred_at)+'<br>'+esc(x.reason)+' · '+esc(x.actor||'Histórico anterior')+'<br>Variação da venda: '+money(x.sales_delta)+'</p>').join('')+'</details>';
    if(error)$('#financeActionSave').hidden=true;
  }
  function saleFields(){
    const s=request.data,a=$('#financeSaleAction').value;
    let body=a==='price'?'<label>Novo preço unitário (R$)<input id="financeUnit" class="input" type="number" min="0.01" step="0.01" required value="'+Number(s.unitPrice).toFixed(2)+'"></label>':
      (a==='cancel'?'<p>Cancelar todas as '+s.qty+' unidade(s) deste item. Os demais itens da compra permanecem.</p>':'<label>Quantidade devolvida<input id="financeQty" class="input" type="number" min="1" max="'+s.qty+'" step="1" value="1" required></label>')+'<label class="finance-check"><input id="financeRestock" type="checkbox"> Devolver as unidades ao estoque (somente se estiverem disponíveis para venda)</label>';
    if(a==='exchange')body+='<label>Produto que o cliente levará<select id="financeReplacement" class="input" required><option value="">Selecione</option>'+state.products.filter(p=>p.active!==false&&!p.isDonation&&(p.qty>0||p.id===s.productId)).map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+' · '+p.qty+' em estoque</option>').join('')+'</select></label><div class="two"><label>Quantidade da troca<input id="financeNewQty" class="input" type="number" min="1" step="1" value="1" required></label><label>Preço unitário da troca<input id="financeNewUnit" class="input" type="number" min="0.01" step="0.01" required></label></div>';
    if(s.payment==='Crediário VIP')body+='<label>Vencimento de eventual diferença a receber<input id="financeDue" class="input" type="date" min="'+today()+'" value="'+range('day',new Date(Date.parse(today()+'T12:00:00Z')+30*86400000).toISOString().slice(0,10))[0]+'"></label><p class="hint">Reduções abatem as últimas parcelas em aberto. Recebimentos anteriores permanecem no histórico.</p>';
    $('#financeSaleFields').innerHTML=body;
    $('#financeReplacement')?.addEventListener('change',()=>{const p=state.products.find(x=>x.id===$('#financeReplacement').value);$('#financeNewUnit').value=p?(Number(p.price)*(1-Number(p.discountPercent||0)/100)).toFixed(2):'';previewSale();});
    $('#financeSaleFields').querySelectorAll('input,select').forEach(el=>el.addEventListener('input',previewSale));previewSale();
  }
  function previewSale(){const s=request.data,a=$('#financeSaleAction').value;const returned=a==='cancel'?s.qty:num('#financeQty');const delta=a==='price'?num('#financeUnit')*s.qty-s.total:-returned*s.unitPrice+(a==='exchange'?num('#financeNewUnit')*num('#financeNewQty'):0);$('#financeSalePreview').textContent='Variação do valor da compra: '+money(delta)+'. O servidor confere estoque, parcelas e diferenças. Valores a devolver ou receber ficam nas pendências do Caixa.'+(s.repassePaidAmount>0?' O repasse já pago será preservado; eventual recuperação do valor ficará pendente.':'');}

  async function submitAction(e){
    e.preventDefault();if(!request||request.busy)return;const req=request;let name,args,summary=$('#financeActionTitle').textContent;const note=$('#financeReason')?.value.trim()||'';
    if(req.kind==='sale'){
      const a=$('#financeSaleAction').value;const data={unit_price:num('#financeUnit'),qty:num('#financeQty'),restock:!!$('#financeRestock')?.checked,product_id:$('#financeReplacement')?.value||null,new_qty:num('#financeNewQty'),new_unit_price:num('#financeNewUnit'),due_date:$('#financeDue')?.value||null};
      name='finance_change_sale';args={p_id:req.id,p_sale_id:req.data.id,p_revision:req.data.revision||0,p_action:a,p_data:data,p_reason:note};summary+=' · '+$('#financeSalePreview').textContent;
    }else if(req.kind==='settle'){name='finance_settle';args={p_id:req.id,p_pending:req.data.id,p_method:$('#financeMethod').value,p_net:req.data.kind==='card'?num('#financeNet'):null,p_reason:note,p_record_only:$('#financeResolution')?.value==='record'};summary+=' · '+money(Math.abs(req.data.amount));
    }else if(req.kind==='reverse'){name='finance_reverse';args={p_id:req.id,p_movement:req.data,p_reason:note};
    }else if(req.kind==='reopen'){name='finance_reopen';args={p_id:req.data,p_reason:note};
    }else if(req.kind==='close'){name='finance_close';args={p_id:req.id,p_day:req.data.from,p_counted:num('#financeCounted'),p_note:note,p_token:req.data.token};summary+=' · contado '+money(args.p_counted)+' · diferença '+money(args.p_counted-req.data.cash_balance);
    }else if(req.kind==='owner'){name='finance_pay_owner';args={p_id:req.id,p_owner:req.data.owner,p_expected:req.data.total,p_method:$('#financeMethod').value};summary+=' · '+money(req.data.total);}
    if(!name)return;req.busy=true;busy(e.target,true);
    try{await authorize(summary);await rpc(name,args);req.busy=false;closeAction();toast('Operação confirmada. Histórico preservado.');await refreshAfter();}
    catch(err){errorAt($('#financeActionError'),err);req.busy=false;}
    finally{busy(e.target,false);}
  }
  window.markOwnerPaid=function(encoded){const owner=decodeURIComponent(encoded),total=state.sales.filter(s=>s.owner===owner&&s.mode==='consignado').reduce((a,s)=>a+Math.max(0,s.repasse-(s.repassePaidAmount||0)),0);if(!total)return;openAction('Confirmar repasse','<p>'+esc(owner)+' · '+money(total)+'</p><p class="hint">Confirme somente após efetuar o pagamento ao consignante.</p><label>Forma do pagamento<select id="financeMethod" class="input">'+methods(true)+'</select></label>','owner',{owner,total});};
  window.renderRepasses=function(){const groups={};state.sales.filter(s=>s.mode==='consignado'&&s.repasse>(s.repassePaidAmount||0)).forEach(s=>(groups[s.owner]??=[]).push(s));$('#repasseList').innerHTML=Object.entries(groups).map(([owner,rows])=>'<div class="repasse-card"><strong>'+esc(owner)+'</strong><div class="total">'+money(rows.reduce((a,s)=>a+s.repasse-(s.repassePaidAmount||0),0))+'</div><div class="meta">'+rows.map(s=>esc(s.productName)+' · '+money(s.repasse-(s.repassePaidAmount||0))).join('<br>')+'</div><button class="mini" data-fin-owner="'+esc(owner)+'">Confirmar pagamento</button></div>').join('')||'<div class="empty">Nenhum repasse pendente. Recuperações de repasses ficam no Caixa.</div>';};
  async function closurePdf(id){const {data,error}=await c().from('cash_closures').select('*').eq('id',id).single();if(error)throw error;window.downloadFinancePdf(data.snapshot,data);}
  function setup(){
    if(!$('#financeDate'))return;$('#financeDate').value=today();
    $('#financePeriod').addEventListener('change',renderCash);$('#financeDate').addEventListener('change',renderCash);$('#financeRefresh').addEventListener('click',()=>window.tudoTalCloud.syncAndRefresh());
    $('#financePdf').addEventListener('click',async()=>{try{if(!report)return;const close=report.from===report.to&&report.closures.find(x=>!x.reopened_at&&x.day===report.from);if(close)await closurePdf(close.id);else window.downloadFinancePdf(report);}catch(e){errorAt($('#financeStatus'),e);}});
    $('#financeClose').addEventListener('click',()=>{if(!report)return;openAction('Conferir e fechar '+dayLabel(report.from),'<p>Dinheiro esperado na gaveta: <strong>'+money(report.cash_balance)+'</strong></p><p class="hint">Informe somente o dinheiro físico. Pix e cartão estão separados. Fechar o dia bloqueia novas operações financeiras nessa data; é possível reabrir com justificativa. Uma diferença fica registrada na conferência; ela não cria automaticamente uma entrada ou saída.</p><label>Dinheiro contado (R$)<input id="financeCounted" type="number" class="input" step="0.01" min="0" required></label>'+reason(),'close',structuredClone(report));});
    $('#financeActionForm').addEventListener('submit',submitAction);$('#financeActionCancel').addEventListener('click',closeAction);$('#financeActionDialog').addEventListener('cancel',e=>{e.preventDefault();closeAction();});
    $('#financeAuthForm').addEventListener('submit',submitAuth);$('#financeAuthCancel').addEventListener('click',cancelAuth);$('#financeAuthDialog').addEventListener('cancel',e=>{e.preventDefault();cancelAuth();});
    $('#salesHistorySearch').addEventListener('input',()=>{historyLimit=50;renderSalesHistory();});$('#salesHistoryStatus').addEventListener('change',renderSalesHistory);$('#salesHistoryMore').addEventListener('click',()=>{historyLimit+=50;renderSalesHistory();});
    document.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;const d=b.dataset;
      if(d.finSale)openSale(d.finSale).catch(err=>toast(err.message));
      if(d.finReverse)openAction('Estornar lançamento manual','<p>O registro original permanece e uma movimentação inversa será lançada hoje.</p>'+reason(),'reverse',d.finReverse);
      if(d.finReopen)openAction('Reabrir dia fechado','<p>O fechamento anterior será preservado. Após a correção, faça uma nova conferência e fechamento.</p>'+reason(),'reopen',d.finReopen);
      if(d.finClosePdf)closurePdf(d.finClosePdf).catch(err=>toast(err.message));
      if(d.finOwner)window.markOwnerPaid(encodeURIComponent(d.finOwner));
      if(d.finSettle){const f=report?.pending.find(x=>x.id===d.finSettle);if(!f)return;openAction(f.description,'<p>'+esc(f.customer_name||f.product_name)+' · <strong>'+money(Math.abs(f.amount))+'</strong></p><label>Forma da movimentação<select id="financeMethod" class="input">'+methods()+'</select></label>'+(f.kind==='card'?'<label>Valor líquido efetivamente recebido (R$)<input id="financeNet" class="input" type="number" min="0" max="'+f.amount+'" step="0.01" required></label><p class="hint">A diferença para o valor bruto será registrada como taxa de cartão. Confira no extrato; o aplicativo não consulta a maquininha automaticamente.</p>':'<label>Como está regularizando?<select id="financeResolution" class="input"><option value="real">Dinheiro já recebido ou devolvido</option><option value="record">Correção do registro: o valor lançado estava errado</option></select></label><p class="hint">O aplicativo registra a operação. Ele não faz transferências nem estornos na maquininha.</p>')+reason(),'settle',f);if(f.kind==='card')$('#financeMethod').value='Transferência';}
    });
    setInterval(()=>{if(document.visibilityState==='visible'&&!request&&!authRequest&&['caixa','historico','dashboard','produtos'].includes(state.view))window.tudoTalCloud?.syncAndRefresh();},30000);
  }
  document.addEventListener('DOMContentLoaded',setup);
})();
