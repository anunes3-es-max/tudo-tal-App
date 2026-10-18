"use strict";
// Role-specific UI. All permissions and approvals are checked again by PostgreSQL.
window.tdtAccess=(()=>{
 let profile=null,products=[],cart=[],requestId=crypto.randomUUID(),activeAt=Date.now(),heartbeatAt=0,locked=false;
 const mobile=()=>matchMedia('(pointer:coarse)').matches;
 const api=async(action,data={})=>{const r=await window.tudoTalSupabase.rpc('access_control',{p_action:action,p_data:data});if(r.error)throw r.error;return r.data;};
 const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const brl=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const by=id=>document.getElementById(id);
 function message(e){alert(e.message||String(e));}
 async function clearPrivateCache(){
   sessionStorage.removeItem('tdtSaleCart');
   await new Promise((resolve,reject)=>{const q=indexedDB.open('TudoTalDB',1);q.onsuccess=()=>{const d=q.result;const names=[...d.objectStoreNames];if(!names.length){d.close();resolve();return;}const t=d.transaction(names,'readwrite');names.forEach(n=>t.objectStore(n).clear());t.oncomplete=()=>{d.close();resolve();};t.onerror=()=>{d.close();reject(t.error);};};q.onerror=()=>reject(q.error);});
 }
 async function lock(){
   if(locked)return;locked=true;
   document.body.classList.add('auth-locked');by('authGate').classList.remove('hidden');
   by('loginPassword').value='';by('authStatus').textContent='Sessão bloqueada. Confirme sua senha para continuar.';
   // Preserve a draft only in this tab and for this identity.
   if(profile?.role==='staff')sessionStorage.setItem('tdtSellerDraft',JSON.stringify({user:profile.user_id,cart,requestId}));
   try{await api('lock');}catch(_){}
 }
 async function signout(){
   await lock();await window.tudoTalSupabase.auth.signOut({scope:'local'});
   await clearPrivateCache();sessionStorage.removeItem('tdtSellerDraft');location.replace(location.pathname);
 }
 async function init(p){
   profile=p;locked=false;activeAt=Date.now();
   if(localStorage.getItem('tdtCacheOwner')!==p.user_id){await clearPrivateCache();localStorage.setItem('tdtCacheOwner',p.user_id);sessionStorage.removeItem('tdtSellerDraft');}
   document.addEventListener('pointerdown',activity,{passive:true});document.addEventListener('keydown',activity);
   document.addEventListener('visibilitychange',()=>{if(document.hidden&&mobile())lock();else if(!document.hidden&&Date.now()-activeAt>=1800000)lock();});
   window.addEventListener('pagehide',()=>{if(mobile())lock();});
   window.addEventListener('storage',e=>{if(e.key==='tdtCacheOwner'&&e.newValue!==p.user_id){document.body.classList.add('auth-locked');location.reload();}});
   setInterval(()=>{if(!locked&&Date.now()-activeAt>=1800000)lock();},10000);
   const bar=document.createElement('div');bar.className='access-toolbar';bar.innerHTML=`<span>${html(p.name)} · ${p.role==='admin'?'Administrador':'Vendedor'}</span><button type="button" data-access="lock">Bloquear</button><button type="button" data-access="out">Trocar conta / sair</button>`;
   document.querySelector('.topbar').after(bar);bar.querySelector('[data-access="lock"]').onclick=lock;bar.querySelector('[data-access="out"]').onclick=signout;
   if(p.role==='staff'){
     document.body.classList.add('seller-mode');
     const root=document.createElement('main');root.id='sellerPortal';document.querySelector('#app').after(root);
     try{const draft=JSON.parse(sessionStorage.getItem('tdtSellerDraft')||'null');if(draft?.user===p.user_id){cart=draft.cart;requestId=draft.requestId;}}catch(_){}
     await seller();
   }else{
     const root=document.createElement('div');root.id='accessPanel';root.className='panel';by('view-config').querySelector('.section-head').after(root);
     await panel();
   }
 }
 function activity(){
   if(locked)return;
   if(Date.now()-activeAt>=1800000){lock();return;}
   activeAt=Date.now();
   if(Date.now()-heartbeatAt>60000){heartbeatAt=Date.now();api('heartbeat').catch(()=>lock());}
 }
 async function freshAdmin(){
   // Isolated modal, no password persistence; remains the same admin identity.
   const password=await passwordDialog();if(!password)throw Error('Confirmação cancelada.');
   const {data:{user}}=await window.tudoTalSupabase.auth.getUser();
   const r=await window.tudoTalSupabase.auth.signInWithPassword({email:user.email,password});
   if(r.error)throw Error('Senha incorreta.');
   if(r.data.user.id!==profile.user_id)throw Error('Conta administrativa diferente.');
   await mfaIfNeeded();await api('unlock',{device:navigator.userAgent});
 }
 function passwordDialog(){return new Promise(resolve=>{
   const d=document.createElement('dialog');d.className='access-dialog';d.innerHTML='<form><h2>Confirmar administrador</h2><p>Autorize somente a operação que acabou de revisar.</p><label>Sua senha<input type="password" autocomplete="current-password" required></label><div class="access-actions"><button type="submit">Confirmar</button><button type="button">Cancelar</button></div></form>';
   document.body.append(d);const finish=v=>{d.close();d.remove();resolve(v);};d.querySelector('form').onsubmit=e=>{e.preventDefault();const i=d.querySelector('input'),v=i.value;i.value='';finish(v);};d.querySelector('button[type=button]').onclick=()=>finish(null);d.oncancel=e=>{e.preventDefault();finish(null);};d.showModal();
 });}
 async function mfaIfNeeded(){
   const {data,error}=await window.tudoTalSupabase.auth.mfa.listFactors();if(error)throw error;
   const f=data.totp?.find(x=>x.status==='verified');if(!f)return;
   const code=prompt('Digite o código de 6 dígitos do seu autenticador:');if(!code)throw Error('Código obrigatório.');
   const r=await window.tudoTalSupabase.auth.mfa.challengeAndVerify({factorId:f.id,code});if(r.error)throw r.error;
 }
 async function account(host){
   const sessions=await api('sessions');
   host.innerHTML=`<h2>Minha conta e aparelhos</h2><div class="access-actions"><button id="accessReset">Alterar senha por e-mail</button>${profile.role==='admin'?'<button id="accessMfa">Autenticação em duas etapas</button>':''}</div><p>Bloqueio após 30 minutos sem atividade. No celular, ao sair do aplicativo. Biometria será avaliada na próxima etapa.</p><div>${sessions.map(s=>`<div class="access-session"><span>${s.current?'Este aparelho':'Outro acesso'} · ${html(s.device)}<small>Última atividade: ${new Date(s.last_seen).toLocaleString('pt-BR')}</small></span><button data-revoke="${s.id}">Encerrar</button></div>`).join('')}</div>`;
   by('accessReset').onclick=async()=>{try{const {data:{user}}=await window.tudoTalSupabase.auth.getUser();const r=await window.tudoTalSupabase.auth.resetPasswordForEmail(user.email,{redirectTo:APP_URL});if(r.error)throw r.error;alert('Solicitação enviada. Confira seu e-mail.');}catch(e){message(e);}};
   host.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=async()=>{try{await api('revoke',{id:b.dataset.revoke});if(sessions.find(s=>s.id===b.dataset.revoke)?.current)await signout();else await account(host);}catch(e){message(e);}});
   if(by('accessMfa'))by('accessMfa').onclick=setupMfa;
 }
 async function setupMfa(){try{
   await freshAdmin();const {data}=await window.tudoTalSupabase.auth.mfa.listFactors();
   if(data.totp.some(f=>f.status==='verified')){alert('Autenticação em duas etapas já está ativa. Guarde o acesso ao seu autenticador.');return;}
   const {data:f,error}=await window.tudoTalSupabase.auth.mfa.enroll({factorType:'totp',friendlyName:'Tudo & Tal'});if(error)throw error;
   const d=document.createElement('dialog');d.className='access-dialog';d.innerHTML='<h2>Conecte seu autenticador</h2><p>Escaneie no aplicativo autenticador e guarde o acesso a ele.</p><img alt="QR do autenticador"><label>Código de 6 dígitos<input inputmode="numeric" maxlength="6"></label><button>Ativar</button><button>Cancelar</button>';
   d.querySelector('img').src=f.totp.qr_code;document.body.append(d);d.showModal();
   d.querySelectorAll('button')[0].onclick=async()=>{try{const r=await window.tudoTalSupabase.auth.mfa.challengeAndVerify({factorId:f.id,code:d.querySelector('input').value});if(r.error)throw r.error;d.remove();alert('Autenticação em duas etapas ativada.');}catch(e){message(e);}};
   d.querySelectorAll('button')[1].onclick=async()=>{await window.tudoTalSupabase.auth.mfa.unenroll({factorId:f.id});d.remove();};
 }catch(e){message(e);}}
 async function panel(){
   const data=await api('panel'),root=by('accessPanel');
   root.innerHTML=`<h2>Acessos e permissões</h2><p>Administrador: gestão completa. Vendedor: consulta de estoque e vendas, com aprovação para descontos e correções.</p><div class="access-slots">${data.slots.map(s=>`<form data-slot="${s.slot}" class="access-slot"><h3>${html(s.name||'Vendedor '+s.slot)} · ${s.enabled?'Ativo':s.user_id?(s.onboarded?'Suspenso / aguardando ativação':'Pendente'):'Disponível'}</h3><label>Nome<input name="name" value="${html(s.name)}" required minlength="2"></label><label>E-mail<input name="email" type="email" value="${html(s.email)}" ${s.user_id?'readonly':''} required></label><label>Telefone (opcional)<input name="phone" value="${html(s.phone)}"></label><div class="access-actions"><button type="submit">Salvar cadastro</button><button type="button" data-slotaction="invite">${s.user_id?'Reenviar acesso':'Enviar convite'}</button>${s.user_id?`<button type="button" data-slotaction="${s.enabled?'suspend':'activate'}">${s.enabled?'Suspender':'Ativar'}</button><button type="button" data-slotaction="release">Liberar vaga</button>`:''}</div></form>`).join('')}</div><h3>Aprovações pendentes (${data.requests.length})</h3><div id="accessRequests"></div><button id="accessRefresh">Atualizar painel</button><div id="accessAccount"></div><h3>Histórico de acessos e aprovações</h3><div class="access-log">${data.events.map(e=>`<p><strong>${html(e.action)}</strong> · ${html(e.actor_name||e.actor)}<br><small>${new Date(e.occurred_at).toLocaleString('pt-BR')}</small></p>`).join('')||'Nenhuma atividade.'}</div>`;
   root.querySelectorAll('[data-slot]').forEach(form=>{
     const payload=()=>({slot:Number(form.dataset.slot),name:form.elements.name.value,email:form.elements.email.value,phone:form.elements.phone.value});
     form.onsubmit=async e=>{e.preventDefault();try{await freshAdmin();await api('save_slot',payload());await panel();}catch(e){message(e);}};
     form.querySelectorAll('[data-slotaction]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{
       const a=b.dataset.slotaction;if(a==='release'&&!confirm('Suspender esta conta e liberar a vaga? O histórico será preservado.'))return;
       await freshAdmin();
       if(a==='invite'){
         if(!form.reportValidity())return;await api('save_slot',payload());
         const {data,error}=await window.tudoTalSupabase.functions.invoke('seller-invite',{body:{slot:Number(form.dataset.slot)}});
         if(error||data?.error)throw Error(data?.error||'Não foi possível enviar o convite. O cadastro foi preservado; tente reenviar.');
         alert('Acesso enviado por e-mail. Após o primeiro acesso, ative a conta neste painel.');
       }else await api(a,{slot:Number(form.dataset.slot)});
       await panel();
     }catch(e){message(e);}finally{b.disabled=false;}});
   });
   by('accessRefresh').onclick=()=>panel().catch(message);
   data.requests.forEach(q=>{
     const item=document.createElement('div');item.className='access-request';
     let description=q.kind==='checkout'?`Venda · ${q.payload.payment} · desconto extra ${Number(q.payload.discount||0)}%`:`Correção · ${q.payload.action} · venda ${q.payload.sale_id}`;
     const labels={cancel:'Cancelar',return:'Devolver',price:'Corrigir preço',exchange:'Trocar'};description=q.kind==='checkout'?description:`${labels[q.payload.action]||'Correção'} · venda ${q.payload.sale_id}`;
     const lines=q.kind==='checkout'?(q.payload.items||[]).map(i=>`${i.name||i.product_id}: ${i.qty} un. × ${brl(i.price)} (promoção ${Number(i.promotion||0)}%)`).join('\n'):`Quantidade devolvida: ${q.payload.data.qty||'Toda a venda'}\nRetorna ao estoque: ${q.payload.data.restock?'Sim':'Não'}\nNovo preço unitário: ${brl(q.payload.data.unit_price??q.payload.data.new_unit_price)}${q.payload.data.product_id?'\nProduto da troca: '+q.payload.data.product_id+' · '+q.payload.data.new_qty+' un.':''}`;
     item.innerHTML=`<h4>${html(q.seller||q.actor)}</h4><p>${html(description)}</p><pre>${html(lines)}</pre>${q.kind==='checkout'?`<p><strong>Total previsto: ${brl(q.payload.items.reduce((sum,i)=>sum+Math.round(i.price*(1-Math.min(50,Number(i.promotion||0)+Number(q.payload.discount||0))/100)*100)/100*i.qty,0))}</strong></p>`:''}<p>${html(q.payload.reason||'')}</p>${q.payload.plan?`<p>Entrada: ${brl(q.payload.plan.down_payment)} · ${html(q.payload.plan.down_payment_method)}</p><p>${(q.payload.plan.installments||[]).map(i=>`${html(i.due_date)}: ${brl(i.amount)}`).join('<br>')}</p>`:''}<div class="access-actions"><button data-decision="approve">Aprovar e executar</button><button data-decision="reject">Recusar</button></div>`;
     item.querySelectorAll('button').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await freshAdmin();await api(b.dataset.decision,{id:q.id});await panel();if(window.tudoTalCloud)await window.tudoTalCloud.syncAndRefresh();}catch(e){message(e);}finally{b.disabled=false;}});
     by('accessRequests').append(item);
   });
   await account(by('accessAccount'));
 }
 async function seller(){
   products=await api('stock');const root=by('sellerPortal');
   root.innerHTML='<h1>Estoque e vendas</h1><p>Consulte os produtos e monte a sacola. Descontos extras e correções precisam de aprovação.</p><div class="access-actions"><input id="sellerSearch" placeholder="Nome, SKU ou leitura do QR"><select id="sellerCategory"><option value="">Todas as categorias</option></select><button id="sellerRefresh">Atualizar</button></div><div id="sellerProducts" class="seller-products"></div><section class="panel"><h2>Sacola</h2><div id="sellerCart"></div><div class="two"><label>Pagamento<select id="sellerPayment"><option>Pix</option><option>Dinheiro</option><option>Débito</option><option>Crédito à vista</option><option>Crédito parcelado</option><option>Crediário VIP</option></select></label><label>Desconto extra (%)<input id="sellerDiscount" type="number" min="0" max="50" value="0"></label><label>Parcelas no cartão<input id="sellerInstallments" type="number" min="1" max="12" value="1"></label><label>Bandeira<select id="sellerBrand"><option>Visa/Mastercard</option><option>Elo/Amex</option></select></label></div><div id="sellerVip" class="hidden"><label>Nome do cliente<input id="sellerCustomer"></label><label>WhatsApp<input id="sellerPhone"></label><label>Entrada<input id="sellerDown" type="number" min="0" step="0.01" value="0"></label><label>Forma da entrada<select id="sellerDownMethod"><option>Pix</option><option>Dinheiro</option><option>Transferência</option></select></label><h3>Parcelas combinadas</h3><div id="sellerPlan"></div><button type="button" id="sellerAddInstallment">Adicionar parcela</button></div><button id="sellerFinish" class="primary">Finalizar / solicitar aprovação</button><p id="sellerResult" role="status"></p></section><section class="panel"><h2>Minhas vendas e solicitações</h2><div id="sellerHistory"></div></section><section id="sellerAccount" class="panel"></section>';
   [...new Set(products.map(p=>p.category))].sort().forEach(c=>by('sellerCategory').add(new Option(c,c)));
   by('sellerSearch').oninput=renderStock;by('sellerCategory').onchange=renderStock;
   by('sellerSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const input=by('sellerSearch').value.trim();let sku=input;try{sku=new URL(input).searchParams.get('sku')||input;}catch(_){}const p=products.find(p=>p.sku.toLowerCase()===sku.toLowerCase());if(p){add(p.id);by('sellerSearch').value='';renderStock();}}};
   by('sellerRefresh').onclick=async()=>{try{products=await api('stock');renderStock();renderCart();await history();}catch(e){message(e);}};
   by('sellerPayment').onchange=()=>{by('sellerVip').classList.toggle('hidden',by('sellerPayment').value!=='Crediário VIP');};
   by('sellerAddInstallment').onclick=()=>{const row=document.createElement('div');row.className='access-actions vip-row';row.innerHTML='<label>Vencimento<input type="date" required></label><label>Valor<input type="number" min="0.01" step="0.01" required></label><button type="button">Remover</button>';row.querySelector('button').onclick=()=>row.remove();by('sellerPlan').append(row);};by('sellerFinish').onclick=checkout;renderStock();renderCart();await history();await account(by('sellerAccount'));
 }
 function renderStock(){const q=by('sellerSearch').value.toLowerCase(),category=by('sellerCategory').value;by('sellerProducts').innerHTML=products.filter(p=>(!category||p.category===category)&&`${p.name} ${p.sku}`.toLowerCase().includes(q)).map(p=>`<article><img src="${html(/^https:\/\//.test(p.photo_url||'')?p.photo_url:'assets/icon.svg')}" alt=""><div><strong>${html(p.name)}</strong><small>${html(p.sku)} · ${html(p.size||'')} · ${p.qty} un.</small><span>${brl(p.price*(1-p.discount_percent/100))}${p.is_donation?' · Doação':''}</span></div><button data-add="${html(p.id)}" ${p.qty<1||p.is_donation?'disabled':''}>Adicionar</button></article>`).join('');by('sellerProducts').querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>add(b.dataset.add));}
 function add(id){const p=products.find(x=>x.id===id);if(!p||p.is_donation)return;let line=cart.find(x=>x.id===id);if((line?.qty||0)>=p.qty){alert('Quantidade disponível atingida.');return;}if(line)line.qty++;else cart.push({id,qty:1});requestId=crypto.randomUUID();renderCart();}
 function renderCart(){let total=0;by('sellerCart').innerHTML=cart.map(l=>{const p=products.find(p=>p.id===l.id);if(!p)return '';total+=p.price*(1-p.discount_percent/100)*l.qty;return `<div class="access-session"><span>${html(p.name)} · ${l.qty} un.</span><button data-remove="${html(l.id)}">Remover</button></div>`;}).join('')+`<p><strong>Subtotal: ${brl(total)}</strong></p>`;by('sellerCart').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{cart=cart.filter(l=>l.id!==b.dataset.remove);requestId=crypto.randomUUID();renderCart();});}
 async function checkout(){const b=by('sellerFinish');b.disabled=true;try{
   if(!cart.length)throw Error('Adicione um produto.');
   const payload={id:requestId,items:cart.map(l=>{const p=products.find(p=>p.id===l.id);if(!p)throw Error('Atualize o estoque.');return{product_id:l.id,qty:l.qty,name:p.name,price:p.price,promotion:p.discount_percent};}),discount:Number(by('sellerDiscount').value),payment:by('sellerPayment').value,installments:Number(by('sellerInstallments').value),brand:by('sellerBrand').value};
   if(payload.payment==='Crediário VIP'){
     payload.customer_name=by('sellerCustomer').value;payload.customer_phone=by('sellerPhone').value;
     payload.plan={down_payment:Number(by('sellerDown').value),down_payment_method:by('sellerDownMethod').value,installments:[...by('sellerPlan').querySelectorAll('.vip-row')].map(row=>({due_date:row.querySelector('input[type=date]').value,amount:Number(row.querySelector('input[type=number]').value)}))};
   }
   const r=await api('checkout',payload);by('sellerResult').textContent=r.status==='pending'?'Solicitação enviada. A venda só será registrada após a aprovação.':'Venda confirmada e estoque atualizado.';
   cart=[];requestId=crypto.randomUUID();sessionStorage.removeItem('tdtSellerDraft');products=await api('stock');renderStock();renderCart();await history();
 }catch(e){message(e);}finally{b.disabled=false;}}
 async function history(){const [sales,requests]=await Promise.all([api('my_sales'),api('my_requests')]);by('sellerHistory').innerHTML=requests.map(r=>`<p>Solicitação ${html(r.id.slice(0,8))}: <strong>${html({pending:'Aguardando aprovação',completed:'Concluída',rejected:'Recusada'}[r.status]||r.status)}</strong></p>`).join('')+sales.map(s=>`<div class="access-session"><span>${html(s.product_name)} · ${s.qty} un. · ${brl(s.total)}<small>${new Date(s.sale_date).toLocaleString('pt-BR')} · ${html(s.status)}</small></span><button data-change="${html(s.id)}">Solicitar correção</button></div>`).join('');by('sellerHistory').querySelectorAll('[data-change]').forEach(b=>b.onclick=()=>change(sales.find(s=>s.id===b.dataset.change)));}
 function change(s){const d=document.createElement('dialog');d.className='access-dialog';d.innerHTML=`<form><h2>Solicitar correção</h2><p>${html(s.product_name)} · ${brl(s.total)}</p><label>Operação<select name="action"><option value="cancel">Cancelar venda</option><option value="return">Devolver parte</option><option value="price">Corrigir preço</option><option value="exchange">Trocar produto</option></select></label><label>Quantidade a devolver/trocar<input name="qty" type="number" min="1" max="${s.qty}" value="1"></label><label>Novo preço unitário<input name="price" type="number" min="0.01" step="0.01" value="${s.unit_price}"></label><label>Produto para troca<select name="product">${products.filter(p=>p.qty>0&&!p.is_donation).map(p=>`<option value="${html(p.id)}">${html(p.name)}</option>`).join('')}</select></label><label>Quantidade do novo produto<input name="newqty" type="number" min="1" value="1"></label><label><input name="restock" type="checkbox" checked> Devolver ao estoque</label><label>Motivo<textarea name="reason" required minlength="5"></textarea></label><button>Solicitar aprovação</button><button type="button">Voltar</button></form>`;document.body.append(d);d.showModal();d.querySelector('button[type=button]').onclick=()=>d.remove();d.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.target.elements,a=f.action.value;try{let data={restock:f.restock.checked};if(a==='return'||a==='exchange')data.qty=Number(f.qty.value);if(a==='price')data.unit_price=Number(f.price.value);if(a==='exchange'){data.product_id=f.product.value;data.new_qty=Number(f.newqty.value);data.new_unit_price=Number(f.price.value);}await api('request_change',{id:crypto.randomUUID(),sale_id:s.id,revision:s.revision,action:a,data,reason:f.reason.value});d.remove();await history();}catch(e){message(e);}};}
 return{api,init,lock,signout,clearPrivateCache,mfaIfNeeded,get profile(){return profile;}};
})();
