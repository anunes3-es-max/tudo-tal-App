"use strict";
(function(){
  const cents=value=>Math.round((Number(value)||0)*100);
  const decimal=value=>Number(String(value??'').replace(',','.'));
  const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
  const afterDays=(date,days)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+days);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00'));
  const total=()=>cents(pdvTotals().final);
  let receiptRows=[],receiptRequest=null,renderSequence=0;

  function agreement(){
    const c=state.saleCheckout||(state.saleCheckout={});
    if(!c.vip)c.vip={customerName:'',customerPhone:'',downPayment:0,method:'Pix',installments:[],automatic:true};
    return c.vip;
  }
  function distribute(count){
    const v=agreement(),balance=Math.max(0,total()-cents(v.downPayment));
    const n=Math.max(1,Math.min(24,Math.floor(Number(count)||2))),base=Math.floor(balance/n);
    v.installments=Array.from({length:n},(_,i)=>({amount:(base+(i===n-1?balance-base*n:0))/100,due_date:afterDays(today(),30*(i+1))}));
    v.automatic=true;v.plannedTotal=total();
  }
  window.vipReadCheckout=function(){
    if(!$('#vipCustomerName'))return;
    const v=agreement();
    v.customerName=$('#vipCustomerName').value.trim();v.customerPhone=$('#vipCustomerPhone').value.trim();
    v.downPayment=decimal($('#vipDownPayment').value);v.method=$('#vipDownPaymentMethod').value;
    v.installments=v.installments.map((row,i)=>({amount:decimal($('#vipAmount-'+i)?.value??row.amount),due_date:$('#vipDue-'+i)?.value??row.due_date}));
  };
  function save(){if(typeof pdvCartSave==='function')pdvCartSave()}
  function validate(requireCustomer=true){
    const v=agreement(),down=cents(v.downPayment),schedule=v.installments;
    if(requireCustomer&&(v.customerName.length<2||v.customerName.length>120))return 'Informe o nome do cliente.';
    const phone=v.customerPhone.replace(/\D/g,'');
    if(phone&&(phone.length<10||phone.length>15))return 'Confira o WhatsApp do cliente.';
    if(!Number.isFinite(v.downPayment)||v.downPayment<0||down>total())return 'A entrada deve ficar entre zero e o total da compra.';
    if(schedule.length>24||(!schedule.length&&down!==total()))return 'Adicione as parcelas do saldo restante.';
    if(schedule.some(r=>!Number.isFinite(r.amount)||r.amount<=0||Math.abs(r.amount*100-cents(r.amount))>0.00001||!validDate(r.due_date)||r.due_date<today()))return 'Confira os valores e vencimentos das parcelas.';
    if(Math.abs(v.downPayment*100-down)>0.00001)return 'Use até duas casas decimais na entrada.';
    const gap=total()-down-schedule.reduce((s,r)=>s+cents(r.amount),0);
    if(gap!==0)return gap>0?'Falta distribuir '+money(gap/100)+'.':'O acordo ultrapassa o total em '+money(-gap/100)+'.';
    return '';
  }
  function summary(){
    const el=$('#vipPlanSummary');if(!el)return;
    const v=agreement(),down=cents(v.downPayment),error=validate(false);
    el.innerHTML='<span>Entrada recebida agora <strong>'+money(down/100)+'</strong></span><span>Saldo a receber <strong>'+money((total()-down)/100)+'</strong></span><p class="'+(error?'vip-error':'vip-ok')+'">'+esc(error||'Acordo confere com o total da compra.')+'</p>';
    const method=$('#vipDownPaymentMethod');if(method)method.disabled=down<=0;
  }
  window.renderVipCheckout=function(){
    const box=$('#paymentExtraFields');if(!box)return;
    const v=agreement();
    if(!v.installments.length&&v.plannedTotal===undefined)distribute(2);
    else if(v.automatic&&v.plannedTotal!==total())distribute(v.installments.length||2);
    box.innerHTML='<div class="vip-plan"><div class="vip-plan-heading"><strong>Combine o pagamento</strong><span>Entrada opcional e parcelas com valores livres.</span></div><div class="two"><label>Nome do cliente<input id="vipCustomerName" class="input" maxlength="120" autocomplete="name" value="'+esc(v.customerName)+'" oninput="vipRememberPlan()" required></label><label>WhatsApp (opcional)<input id="vipCustomerPhone" class="input" type="tel" autocomplete="tel" value="'+esc(v.customerPhone)+'" oninput="vipRememberPlan()"></label></div><div class="two"><label>Entrada recebida agora (R$)<input id="vipDownPayment" class="input" type="number" min="0" step="0.01" value="'+v.downPayment+'" onchange="vipChangeDownPayment()"></label><label>Como recebeu a entrada<select id="vipDownPaymentMethod" class="input" onchange="vipRememberPlan()">'+['Pix','Dinheiro','Transferência','Outro'].map(m=>'<option'+(v.method===m?' selected':'')+'>'+m+'</option>').join('')+'</select></label></div><div class="vip-split"><label>Quantidade de parcelas<input id="vipSplitCount" class="input" type="number" min="1" max="24" value="'+(v.installments.length||2)+'"></label><button type="button" class="mini" onclick="vipSplitBalance()">Dividir saldo igualmente</button></div><div class="vip-installments">'+v.installments.map((r,i)=>'<div class="vip-installment"><strong>Parcela '+(i+1)+'</strong><label>Valor (R$)<input id="vipAmount-'+i+'" class="input" type="number" min="0.01" step="0.01" value="'+r.amount.toFixed(2)+'" oninput="vipEditInstallment()"></label><label>Vencimento<input id="vipDue-'+i+'" class="input" type="date" min="'+today()+'" value="'+esc(r.due_date)+'" onchange="vipEditInstallment()"></label><button type="button" class="ghost" aria-label="Retirar parcela '+(i+1)+'" onclick="vipRemoveInstallment('+i+')">Retirar</button></div>').join('')+'</div><button type="button" class="mini" onclick="vipAddInstallment()"'+(v.installments.length>=24?' disabled':'')+'>+ Adicionar parcela</button><div id="vipPlanSummary" class="vip-plan-summary" aria-live="polite"></div></div>';
    summary();save();
  };
  window.vipRememberPlan=function(){vipReadCheckout();summary();save()};
  window.vipEditInstallment=function(){vipReadCheckout();agreement().automatic=false;summary();save()};
  window.vipChangeDownPayment=function(){vipReadCheckout();const v=agreement();if(v.automatic){if(cents(v.downPayment)===total()){v.installments=[];v.plannedTotal=total()}else distribute(v.installments.length||2)}renderVipCheckout()};
  window.vipSplitBalance=function(){vipReadCheckout();if(cents(agreement().downPayment)===total()){agreement().installments=[];agreement().plannedTotal=total()}else distribute($('#vipSplitCount').value);renderVipCheckout()};
  window.vipRemoveInstallment=function(i){vipReadCheckout();agreement().installments.splice(i,1);agreement().automatic=false;renderVipCheckout()};
  window.vipAddInstallment=function(){vipReadCheckout();const v=agreement();if(v.installments.length>=24)return;const gap=total()-cents(v.downPayment)-v.installments.reduce((s,r)=>s+cents(r.amount),0);v.installments.push({amount:Math.max(0,gap)/100,due_date:afterDays(v.installments.at(-1)?.due_date||today(),30)});v.automatic=false;renderVipCheckout()};
  window.vipCheckoutPayload=function(){
    vipReadCheckout();const error=validate();if(error)throw new Error(error);
    const v=agreement();return {customerName:v.customerName,customerPhone:v.customerPhone,plan:{down_payment:cents(v.downPayment)/100,down_payment_method:v.method,installments:v.installments.map(r=>({amount:cents(r.amount)/100,due_date:r.due_date}))}};
  };

  function saleFor(row){return state.sales.find(s=>s.id===row.sale_id)}
  function customerFor(row){return saleFor(row)?.customerName||'Cliente não informado'}
  function balance(row){return Math.max(0,cents(row.amount)-cents(row.paid_amount))/100}
  window.renderFlexibleVipReceivables=async function(){
    const list=$('#vipReceivables'),summaryEl=$('#vipReceivableSummary');if(!list||!summaryEl)return;
    const sequence=++renderSequence;
    try{
      const [rows,payments]=await Promise.all([window.tudoTalCloud.fetchReceivables(),window.tudoTalCloud.fetchVipPayments()]);
      if(sequence!==renderSequence)return;receiptRows=rows;
      const pending=rows.filter(r=>balance(r)>0),paid=rows.reduce((s,r)=>s+cents(r.paid_amount),0),remaining=pending.reduce((s,r)=>s+cents(balance(r)),0),overdue=pending.filter(r=>r.due_date<today());
      summaryEl.innerHTML='<div class="receivable-summary-card"><span>A receber</span><strong>'+money(remaining/100)+'</strong><small>'+pending.length+' parcela(s) pendente(s) • '+overdue.length+' vencida(s)</small></div><div class="receivable-summary-card"><span>Já recebido no VIP</span><strong>'+money(paid/100)+'</strong><small>Entradas e pagamentos das parcelas</small></div>';
      list.innerHTML=pending.length?pending.map(r=>{
        const sale=saleFor(r),related=r.cart_id?state.sales.filter(s=>s.cartId===r.cart_id):[sale].filter(Boolean);
        const products=related.map(s=>s.productName).join(' • '),part=r.is_down_payment?'Entrada':'Parcela '+r.installment_number+'/'+r.installment_count;
        return '<div class="receivable-row '+(r.due_date<today()?'overdue':'')+'"><div><strong>'+esc(customerFor(r))+'</strong><div class="meta">'+esc(products||'Venda VIP')+'</div><div class="meta">'+part+' • vence '+new Date(r.due_date+'T12:00:00').toLocaleDateString('pt-BR')+(r.due_date<today()?' • VENCIDA':'')+'</div><div class="meta">Combinado '+money(r.amount)+' • recebido '+money(r.paid_amount)+'</div></div><div class="receivable-actions"><strong>'+money(balance(r))+'</strong><button class="mini" type="button" onclick="openVipReceipt(\''+r.id+'\')">Receber valor</button></div></div>';
      }).join(''):'<div class="empty">Nenhuma parcela pendente no Crediário VIP.</div>';
      if(payments.length)list.innerHTML+='<details class="vip-history"><summary>Histórico de recebimentos ('+payments.length+')</summary>'+payments.map(p=>{const r=rows.find(row=>row.id===p.receivable_id);return '<div class="receivable-row"><div><strong>'+esc(r?customerFor(r):'Venda VIP')+'</strong><div class="meta">'+(r?.is_down_payment?'Entrada':'Parcela '+(r?.installment_number||''))+' • '+new Date(p.received_at).toLocaleString('pt-BR')+' • '+esc(p.payment_method)+'</div></div><strong>'+money(p.amount)+'</strong></div>'}).join('')+'</details>';
    }catch(err){console.error('Crediário VIP',err);summaryEl.innerHTML='<p class="vip-error">Não consegui atualizar o Crediário VIP. Tente sincronizar novamente.</p>';list.innerHTML=''}
  };
  window.openVipReceipt=function(id){
    const row=receiptRows.find(r=>r.id===id);if(!row||balance(row)<=0)return;
    const dialog=$('#vipReceiptDialog');
    receiptRequest={id,requestId:crypto.randomUUID(),busy:false};
    $('#vipReceiptCustomer').textContent=customerFor(row);
    $('#vipReceiptBalance').textContent='Saldo desta parcela: '+money(balance(row));
    $('#vipReceiptAmount').value=balance(row).toFixed(2);$('#vipReceiptAmount').max=balance(row);
    $('#vipReceiptMethod').value='Pix';$('#vipReceiptError').textContent='';
    $('#vipReceiptSave').disabled=false;$('#vipReceiptCancel').disabled=false;
    dialog.showModal();$('#vipReceiptAmount').focus();
  };
  window.closeVipReceipt=function(){if(!receiptRequest?.busy)$('#vipReceiptDialog').close()};
  window.submitVipReceipt=async function(e){
    e.preventDefault();if(!receiptRequest||receiptRequest.busy)return;
    const row=receiptRows.find(r=>r.id===receiptRequest.id),amount=decimal($('#vipReceiptAmount').value),method=$('#vipReceiptMethod').value;
    if(!Number.isFinite(amount)||amount<=0||amount>balance(row)||Math.abs(amount*100-cents(amount))>0.00001){$('#vipReceiptError').textContent='Informe um valor maior que zero e até o saldo da parcela.';return}
    receiptRequest.busy=true;$('#vipReceiptSave').disabled=true;$('#vipReceiptCancel').disabled=true;$('#vipReceiptError').textContent='';
    try{
      await window.tudoTalCloud.recordVipPayment({id:row.id,amount,requestId:receiptRequest.requestId,method});
      $('#vipReceiptDialog').close();toast('Recebimento registrado: '+money(amount));
      await window.tudoTalCloud.syncAndRefresh();await renderFlexibleVipReceivables();
    }catch(err){$('#vipReceiptError').textContent=String(err?.message||'Não consegui registrar o recebimento. Tente novamente.');}
    finally{receiptRequest.busy=false;$('#vipReceiptSave').disabled=false;$('#vipReceiptCancel').disabled=false}
  };
  document.addEventListener('DOMContentLoaded',()=>{
    $('#vipReceiptForm')?.addEventListener('submit',submitVipReceipt);
    $('#vipReceiptDialog')?.addEventListener('cancel',e=>{if(receiptRequest?.busy)e.preventDefault()});
  });
})();
