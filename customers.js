(()=>{
 const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const label=c=>c.name+' #'+c.customer_number;
 const rpc=async(action,data)=>{const r=await window.tudoTalSupabase.rpc('customer_accounts',{p_action:action,p_data:data});if(r.error)throw r.error;return r.data;};
 window.refreshCustomers=async()=>{const rows=[];for(let offset=0;;offset+=500){const {data,error}=await window.tudoTalSupabase.from('customers').select('*').order('customer_number').range(offset,offset+499);if(error)throw error;rows.push(...data);if(data.length<500)break;}state.customers=rows;return rows;};
 window.customerLabel=id=>{const c=state.customers?.find(c=>c.id===id);return c?label(c):'';};
 window.mountCustomerPicker=async function(selectId,nameId,phoneId,onChange){
  const select=document.getElementById(selectId),name=document.getElementById(nameId),phone=document.getElementById(phoneId);if(!select)return;
  try{
   const rows=await refreshCustomers();if(!select.isConnected)return;
   const selected=name.dataset.customerId||'';select.innerHTML='<option value="">Novo cliente — nome e sobrenome</option>';
   for(const row of rows){const option=document.createElement('option');option.value=row.id;option.textContent=label(row)+' · '+(row.phone||'Sem WhatsApp');select.append(option);}
   const apply=()=>{const row=rows.find(r=>r.id===select.value);name.dataset.customerId=row?.id||'';name.readOnly=phone.readOnly=!!row;if(row){name.value=row.name;phone.value=row.phone;}onChange?.(row);};
   select.value=selected;select.onchange=apply;if(selected)apply();
   if(!select.parentElement.querySelector('[data-customer-search]')){const search=document.createElement('input');search.className='input';search.placeholder='Buscar nome, número ou WhatsApp';search.dataset.customerSearch='1';search.type='search';search.oninput=()=>{const q=norm(search.value).replace(/^#/,'');for(const option of [...select.options].slice(1))option.hidden=!norm(option.textContent).includes(q);};select.before(search);}
  }catch(error){if(select.isConnected)select.options[0].textContent='Não foi possível carregar clientes. Tente atualizar.';}
 };
 window.ensureCustomer=async function(nameId,phoneId){
  const name=document.getElementById(nameId),phone=document.getElementById(phoneId);if(!name)throw Error('Abra o cadastro do cliente.');
  if(name.dataset.customerId)return name.dataset.customerId;
  const full=name.value.trim().replace(/\s+/g,' '),number=phone.value.replace(/\D/g,'');if(!/^\S+\s+\S/.test(full))throw Error('Informe nome e sobrenome do cliente.');
  const rows=await refreshCustomers(),matches=rows.filter(c=>norm(c.name)===norm(full)||(number&&c.phone===number));
  if(matches.length&&!confirm('Possível cadastro duplicado: '+matches.map(label).join(', ')+'. É OUTRA pessoa e deseja criar um número novo? Se for o mesmo cliente, cancele e selecione o cadastro existente.'))throw Error('Selecione o cliente já cadastrado.');
  const fingerprint=full+'|'+number;if(name.dataset.requestFingerprint!==fingerprint){name.dataset.requestId=crypto.randomUUID();name.dataset.requestFingerprint=fingerprint;}
  const c=await rpc('create',{request_id:name.dataset.requestId,name:full,phone:number,allow_duplicate:matches.length>0});name.dataset.customerId=c.id;name.readOnly=phone.readOnly=true;await refreshCustomers();return c.id;
 };
 window.editCustomerProfile=async id=>{
  const c=state.customers?.find(c=>c.id===id);if(!c)return;
  const d=document.createElement('dialog');d.className='access-dialog';d.innerHTML='<form><h2>Editar '+esc(label(c))+'</h2><p>O número será mantido. Nome e WhatsApp serão atualizados na ficha e nas compras vinculadas.</p><label>Nome e sobrenome<input name="name" class="input" required value="'+esc(c.name)+'"></label><label>WhatsApp<input name="phone" class="input" value="'+esc(c.phone)+'"></label><label>Motivo<textarea name="reason" class="input" minlength="5" required></textarea></label><p role="status"></p><button type="submit">Salvar com senha de administrador</button><button type="button">Voltar</button></form>';
  document.body.append(d);d.showModal();d.querySelector('[type=button]').onclick=()=>d.remove();let busy=false;const request=crypto.randomUUID();
  d.querySelector('form').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;const form=e.target;form.querySelector('[type=submit]').disabled=true;try{await window.financeAuthorize('Corrigir cadastro '+label(c));await rpc('update',{request_id:request,customer_id:id,revision:c.revision,name:form.elements.name.value,phone:form.elements.phone.value,reason:form.elements.reason.value});await window.tudoTalCloud.syncAndRefresh();d.remove();await openCustomerDirectory();}catch(err){d.querySelector('[role=status]').textContent=err.message;}finally{busy=false;form.querySelector('[type=submit]').disabled=false;}};
 };
 function newCustomer(){const d=document.createElement('dialog');d.className='access-dialog';d.innerHTML='<form><h2>Novo cliente</h2><p>O número será gerado automaticamente após salvar.</p><label>Nome e sobrenome<input id="newCustomerName" class="input" required></label><label>WhatsApp (opcional)<input id="newCustomerPhone" class="input" type="tel"></label><p role="status"></p><button type="submit">Cadastrar cliente</button><button type="button">Voltar</button></form>';document.body.append(d);d.showModal();d.querySelector('[type=button]').onclick=()=>d.remove();d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=d.querySelector('[type=submit]');b.disabled=true;try{await ensureCustomer('newCustomerName','newCustomerPhone');d.remove();await openCustomerDirectory();}catch(error){d.querySelector('[role=status]').textContent=error.message;}finally{b.disabled=false;}};}
 let directoryRows=[],creditRows=[],paymentRows=[];
 function renderDirectory(){
  const q=norm(document.querySelector('#customerDirectorySearch').value).replace(/^#/,'');
  const host=document.querySelector('#customerDirectoryList');host.innerHTML=directoryRows.filter(c=>norm(label(c)+' '+c.phone).includes(q)).map(c=>{
   const sales=state.sales.filter(s=>s.customerId===c.id),ids=new Set(sales.map(s=>s.id)),installments=creditRows.filter(r=>ids.has(r.sale_id)),balance=installments.reduce((n,r)=>n+Math.max(0,Number(r.amount)-Number(r.paid_amount)),0),total=sales.reduce((n,s)=>n+Number(s.total),0),received=sales.reduce((n,s)=>n+Number(s.receivedAmount||0),0);
   return '<details class="panel detail-customer"><summary><strong>'+esc(label(c))+'</strong> · A receber '+money(balance)+'</summary><p>'+esc(c.phone||'Sem WhatsApp')+'</p><p>Total atual das compras: '+money(total)+' · Valor recebido aplicado às compras: '+money(received)+' · A receber: '+money(balance)+'</p><button class="mini" data-edit-customer="'+c.id+'">Editar cadastro</button><h3>Todas as compras</h3>'+sales.sort((a,b)=>b.date.localeCompare(a.date)).map(s=>'<article class="list-item"><div><strong>'+esc(s.productName)+'</strong><p>'+new Date(s.date).toLocaleDateString('pt-BR')+' · '+esc(s.payment)+' · '+esc(s.status)+' · '+money(s.total)+'</p><button class="mini" data-fin-sale="'+esc(s.id)+'">Detalhes / corrigir compra</button></div></article>').join('')+(sales.length?'':'<p>Nenhuma compra vinculada.</p>')+'<h3>Parcelas</h3>'+installments.map(r=>'<p>'+String(r.due_date).split('-').reverse().join('/')+' · A receber '+money(Math.max(0,r.amount-r.paid_amount))+(Number(r.amount)>Number(r.paid_amount)?' <button type="button" class="mini" data-detail-receipt="'+esc(r.id)+'">Receber valor</button>':' · Quitada')+'</p>').join('')+'<h3>Histórico de recebimentos VIP</h3>'+paymentRows.filter(p=>installments.some(r=>r.id===p.receivable_id)).map(p=>'<p>'+new Date(p.received_at).toLocaleDateString('pt-BR')+' · '+esc(p.payment_method)+' · '+money(p.amount)+'</p>').join('')+'<button class="mini" data-customer-credit>Ver recebimentos no crediário</button></details>';
  }).join('')||'<p class="empty">Nenhum cliente encontrado.</p>';
 }
 window.openCustomerDirectory=async()=>{nav('clientes');const host=document.querySelector('#customerDirectoryList');host.textContent='Carregando clientes e compras…';try{directoryRows=await refreshCustomers();const data=await window.renderFlexibleVipReceivables();if(!data)throw Error('Não foi possível conferir parcelas e pagamentos.');creditRows=data.rows;paymentRows=data.payments;renderDirectory();}catch(e){host.textContent='Não foi possível carregar: '+e.message;}};
 document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-new-customer'))newCustomer();if(b.hasAttribute('data-open-customers'))openCustomerDirectory();if(b.dataset.editCustomer)editCustomerProfile(b.dataset.editCustomer);if(b.hasAttribute('data-customer-credit'))openDashboardDetail(5);});
 document.addEventListener('DOMContentLoaded',()=>document.querySelector('#customerDirectorySearch')?.addEventListener('input',renderDirectory));
})();
