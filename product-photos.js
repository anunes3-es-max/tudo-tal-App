/* The first image is the cover throughout inventory, POS and the catalog. */
(()=>{
 const MAX=6;
 window.productPhotoList=p=>[...new Set([p.photo,...(Array.isArray(p.photos)?p.photos:[])].filter(Boolean))].slice(0,MAX);
 window.renderProductPhotos=()=>{
  const host=document.querySelector('#photoPreview');host.replaceChildren();
  const photos=state.editPhotos||[];
  if(!photos.length){host.textContent='Nenhuma foto adicionada.';return;}
  photos.forEach((src,index)=>{
   const card=document.createElement('div');card.className='product-photo-editor';
   const img=document.createElement('img');img.src=src;img.alt='Foto '+(index+1);card.append(img);
   const cover=document.createElement('button');cover.type='button';cover.className='mini';cover.textContent=index===0?'Capa':'Usar como capa';cover.disabled=index===0||state.photosLoading;
   cover.onclick=()=>{state.editPhotos.splice(index,1);state.editPhotos.unshift(src);state.editPhoto=src;renderProductPhotos();};
   const remove=document.createElement('button');remove.type='button';remove.className='mini';remove.textContent='Remover';remove.disabled=!!state.photosLoading;
   remove.onclick=()=>{state.editPhotos.splice(index,1);state.editPhoto=state.editPhotos[0]||'';renderProductPhotos();};
   card.append(cover,remove);host.append(card);
  });
 };
 window.fileToPhoto=async file=>{
  if(!file||file.size>25000000)throw Error('Use uma imagem de até 25 MB.');
  if(!/^image\//.test(file.type))throw Error('Selecione um arquivo de imagem.');
  const url=URL.createObjectURL(file);
  try{
   const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('Não foi possível abrir esta foto. Tente exportá-la como JPG.'));i.src=url;});
   const scale=Math.min(1,1440/Math.max(img.naturalWidth,img.naturalHeight));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
   let result=canvas.toDataURL('image/jpeg',.84);if(result.length>950000)result=canvas.toDataURL('image/jpeg',.68);
   if(result.length>950000)throw Error('A foto ficou muito grande. Escolha uma versão menor.');
   return result;
  }finally{URL.revokeObjectURL(url);}
 };
 window.addProductPhotos=async event=>{
  const input=event.target,files=[...input.files];if(!files.length||state.photosLoading)return;
  const photos=state.editPhotos||[];
  if(photos.length+files.length>MAX){toast('Você pode usar até 6 fotos por produto. Remova uma foto para adicionar outra.');input.value='';return;}
  const draft=photos;state.photosLoading=true;input.disabled=true;document.querySelector('#saveProductButton').disabled=true;renderProductPhotos();
  const message=document.querySelector('#photoUploadStatus');message.textContent='Preparando fotos…';
  try{
   const prepared=[];for(const file of files)prepared.push(await fileToPhoto(file));
   // Do not attach an upload to another product if the user navigated away.
   if(state.editPhotos!==draft)return;
   state.editPhotos=[...new Set([...photos,...prepared])];state.editPhoto=state.editPhotos[0]||'';
   message.textContent='Fotos prontas. Clique em Atualizar produto ou Cadastrar produto para salvar.';
  }catch(error){message.textContent=error.message;toast(error.message);}
  finally{state.photosLoading=false;input.disabled=false;input.value='';document.querySelector('#saveProductButton').disabled=false;renderProductPhotos();}
 };
})();
