(()=>{
 'use strict';
 let initialized=false,current=null;
 const defaults={default:['',''],natal:['Presentes de Natal','Escolha um carinho para quem você ama.'],ano_novo:['Um novo ano, novas escolhas','Encontre seu próximo favorito.']};
 const localDate=value=>value?new Date(Date.parse(value)-10800000).toISOString().slice(0,16):'';
 window.initCatalogAppearance=async()=>{
  if(initialized)return;initialized=true;
  const panel=document.createElement('section');panel.className='panel';panel.id='catalogAppearancePanel';
  panel.innerHTML=`<h2>Aparência do catálogo</h2><p class="hint">Confira a prévia antes de publicar. Um tema por vez, sem alterar produtos, preços ou descontos.</p>
  <form id="appearanceForm" class="form">
   <label>Tema<select id="appearanceTheme" class="input"><option value="default">Padrão da loja</option><option value="natal">Natal</option><option value="ano_novo">Ano-Novo</option></select></label>
   <div id="appearanceSeason">
    <label>Título do banner<input id="appearanceTitle" class="input" maxlength="90"></label>
    <label>Mensagem<input id="appearanceMessage" class="input" maxlength="180"></label>
    <div class="two"><label>Quando começa?<select id="appearanceMode" class="input"><option value="now">Publicar agora</option><option value="scheduled">Agendar</option></select></label>
    <label id="appearanceStartLabel">Início<input id="appearanceStart" class="input" type="datetime-local"></label>
    <label>Encerramento<input id="appearanceEnd" class="input" type="datetime-local"></label></div>
    <p class="hint">Horários de Brasília (UTC−3). No encerramento, o catálogo volta ao padrão automaticamente.</p>
   </div>
   <p id="appearanceStatus" class="hint" role="status">Carregando...</p>
   <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" id="appearanceReload" class="secondary">Recarregar configuração</button><button id="appearanceSave" type="submit" class="primary" disabled>Publicar configuração</button></div>
  </form>
  <hr><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><strong>Prévia sem publicar</strong><button type="button" class="secondary" id="appearanceMobile">Celular</button><button type="button" class="secondary" id="appearanceDesktop">Computador</button><button type="button" class="secondary" id="appearancePreview">Atualizar prévia</button></div>
  <div style="overflow:auto;margin-top:16px;background:#e9e9ed;border-radius:12px;padding:8px"><iframe id="appearanceFrame" title="Prévia do catálogo — compras desativadas" sandbox="allow-scripts allow-same-origin" style="display:block;width:390px;max-width:100%;height:660px;border:0;margin:auto;background:white" loading="lazy"></iframe></div>`;
  document.querySelector('#view-config .catalog-config-panel').after(panel);
  const q=id=>panel.querySelector('#appearance'+id),status=text=>{q('Status').textContent=text;};
  function fields(){const seasonal=q('Theme').value!=='default';q('Season').hidden=!seasonal;q('End').required=seasonal;const scheduled=seasonal&&q('Mode').value==='scheduled';q('StartLabel').hidden=!scheduled;q('Start').required=scheduled;q('Save').textContent=seasonal?(scheduled?'Salvar agendamento':'Publicar tema'):'Publicar tema padrão';}
  function preview(){const p=new URLSearchParams({preview_theme:q('Theme').value,title:q('Title').value,message:q('Message').value});q('Frame').src='https://tudoetalstore.github.io/?'+p.toString();}
  function fill(data){current=data;q('Theme').value=data.theme;q('Title').value=data.title||defaults[data.theme][0];q('Message').value=data.message||defaults[data.theme][1];q('Mode').value=data.starts_at?'scheduled':'now';q('Start').value=localDate(data.starts_at);q('End').value=localDate(data.ends_at);fields();preview();const names={default:'Padrão',natal:'Natal',ano_novo:'Ano-Novo'};status('No catálogo agora: '+names[data.active_theme]+'.'+(data.starts_at&&Date.parse(data.starts_at)>Date.parse(data.server_time)?' Agendado: '+names[data.theme]+'.':''));}
  async function load(){q('Save').disabled=true;try{const{data,error}=await window.tudoTalSupabase.rpc('get_catalog_appearance');if(error)throw error;if(!data)throw Error('Configuração indisponível.');fill(data);q('Save').disabled=false;}catch(e){status(e.message||'Não foi possível carregar. Tente novamente.');}}
  q('Theme').addEventListener('change',()=>{[q('Title').value,q('Message').value]=defaults[q('Theme').value];fields();preview();});
  q('Mode').addEventListener('change',fields);
  q('Preview').onclick=preview;q('Reload').onclick=load;
  q('Mobile').onclick=()=>{q('Frame').style.width='390px';q('Frame').style.maxWidth='100%';};
  q('Desktop').onclick=()=>{q('Frame').style.width='1100px';q('Frame').style.maxWidth='none';};
  q('Form').addEventListener('submit',async e=>{
   e.preventDefault();if(!current)return;
   q('Save').disabled=true;
   try{
    const seasonal=q('Theme').value!=='default',scheduled=q('Mode').value==='scheduled';
    const start=seasonal&&scheduled?new Date(q('Start').value+'-03:00').toISOString():null;
    const end=seasonal?new Date(q('End').value+'-03:00').toISOString():null;
    const{data,error}=await window.tudoTalSupabase.rpc('save_catalog_appearance',{p_theme:q('Theme').value,p_title:q('Title').value,p_message:q('Message').value,p_starts_at:start,p_ends_at:end,p_version:current.version});
    if(error)throw error;fill(data);status((seasonal&&scheduled?'Agendamento salvo.':'Tema publicado.')+' O catálogo aberto atualiza em até 30 segundos.');
   }catch(err){status(err.message||'Não foi possível salvar. Recarregue e tente novamente.');}finally{q('Save').disabled=false;}
  });
  await load();
 };
})();
