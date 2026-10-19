/* Contacts are private; selecting one copies its identity to this purchase only. */
(()=>{
 window.mountCustomerPicker=async function(selectId,nameId,phoneId,onChange){
  const select=document.getElementById(selectId);if(!select)return;
  try{
   const rows=[];
   for(let offset=0;;offset+=500){
    const {data,error}=await window.tudoTalSupabase.from('customers').select('id,name,phone').order('name').order('id').range(offset,offset+499);
    if(error)throw error;if(!Array.isArray(data))throw Error('Cadastro indisponível');rows.push(...data);if(data.length<500)break;
   }
   if(!select.isConnected)return;
   for(const row of rows){const option=document.createElement('option');option.value=row.id;option.textContent=row.name+' · '+(row.phone||'Sem WhatsApp');select.append(option);}
   select.onchange=()=>{const row=rows.find(r=>r.id===select.value);if(!row)return;document.getElementById(nameId).value=row.name;document.getElementById(phoneId).value=row.phone;onChange?.();};
  }catch(error){if(select.isConnected){select.options[0].textContent='Cadastro indisponível — preencha nome e WhatsApp abaixo';}}
 };
})();
