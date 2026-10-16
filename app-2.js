function renderProducts(){
  const q=($("#productSearch")?.value||"").trim().toLowerCase();
  const arr=[...state.products].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")).filter(p=>!q||[p.name,p.sku,p.brand,p.owner,p.category].join(" ").toLowerCase().includes(q));
  $("#productList").innerHTML=arr.length?arr.map(p=>{
    const d=Math.max(0,Math.min(50,Number(p.discountPercent||0)));
    const promoPrice=Number(p.price||0)*(1-d/100);
    const photo=p.photo?'<img src="'+p.photo+'" alt="">':'<img src="assets/icon.svg" alt="">';
    const promo=d?'<span class="badge promo-admin-badge">Promo '+String(d).replace(".",",")+'%</span>':'';
    const price=p.isDonation?'<div class="price">Grátis<br><small>Doação</small></div>':d?'<div class="price promo-admin-price"><small>'+money(p.price)+'</small><strong>'+money(promoPrice)+'</strong></div>':'<div class="price">'+money(p.price)+'</div>';
    return '<div class="list-item">'+photo+'<div class="list-main"><strong>'+esc(p.name)+'</strong><div class="meta">'+esc(p.sku)+' • '+esc(p.category)+(p.size?' • '+esc(p.size):'')+'</div><div class="meta">'+esc(p.owner)+' • <span class="badge '+(p.qty>0?'ok':'zero')+'">'+(p.qty>0?p.qty+' em estoque':'Sem estoque')+'</span> '+promo+'</div><div class="item-actions"><button class="mini" onclick="editProduct(\''+p.id+'\')">Editar</button><button class="mini" onclick="labelProduct(\''+p.id+'\')">Etiqueta</button>'+(p.isDonation?'':'<button class="mini" onclick="sellProduct(\''+p.sku+'\')">Vender</button>')+'</div></div>'+price+'</div>';
  }).join(""):'<div class="empty">Nenhum produto encontrado.</div>';
}
function fillCategoryOptions(){$("#productCategory").innerHTML=Object.keys(CATEGORIES).map(c=>`<option>${esc(c)}</option>`).join("")}
function inferCatalogSection(category){return ["Moda Adulto","Moda Infantil","Calçados","Bolsas"].includes(category)?"vestuario":"loja"}
function syncProductCatalogFields(fromCategory=false){
  if(fromCategory){
    $("#productCatalogSection").value=inferCatalogSection($("#productCategory").value);
    if(["Moda Adulto","Moda Infantil"].includes($("#productCategory").value))$("#productAgeGroup").value=$("#productCategory").value==="Moda Infantil"?"infantil":"adulto";
  }
  const clothing=$("#productCatalogSection").value==="vestuario";
  if(!clothing)$("#productOffer").value="sale";
  const donation=clothing&&$("#productOffer").value==="donation";
  $("#productClothingFields").classList.toggle("hidden",!clothing);
  $("#productOfferLabel").classList.toggle("hidden",!clothing);
  $("#productDonationHint").classList.toggle("hidden",!donation);
  $("#productAgeGroup").required=clothing;$("#productGender").required=clothing;
  $("#productSize").required=clothing;
  const price=$("#productPrice"),discount=$("#productDiscount"),mode=$("#productMode");
  price.min=donation?"0":"0.01";price.readOnly=donation;discount.readOnly=donation;mode.disabled=donation;
  if(donation){price.value=0;discount.value=0;mode.value="proprio"}
  else if(price.value!==""&&Number(price.value)===0)price.value="";
}
function resetProductForm(){
  $("#productForm").reset();$("#productForm").dataset.expectedQty="";
  $("#productId").value="";$("#productQty").value=1;$("#productMode").value="consignado";
  $("#productOffer").value="sale";$("#productDiscount").value=0;
  $("#productFormTitle").textContent="Novo produto";$("#saveProductButton").textContent="Cadastrar produto";
  state.editPhoto=null;$("#photoPreview").innerHTML="Sem foto";syncProductCatalogFields(true);
}
function prepareProductForm(){if(!$("#productId").value)resetProductForm()}
window.editProduct=function(id){
  const p=state.products.find(x=>x.id===id);if(!p)return;nav("produto-form");
  $("#productId").value=p.id;$("#productForm").dataset.expectedQty=String(p.qty??0);
  $("#productFormTitle").textContent=`Editar ${p.sku}`;$("#saveProductButton").textContent="Atualizar produto";
  for(const [field,key] of Object.entries({Name:"name",Category:"category",Brand:"brand",Size:"size",Color:"color",Condition:"condition",Mode:"mode",Owner:"owner",OwnerPhone:"ownerPhone",Price:"price",Qty:"qty",Cost:"cost",Discount:"discountPercent"}))$("#product"+field).value=p[key]??"";
  $("#productCatalogSection").value=p.catalogSection||inferCatalogSection(p.category);
  $("#productAgeGroup").value=p.ageGroup||(p.category==="Moda Adulto"?"adulto":p.category==="Moda Infantil"?"infantil":"");
  $("#productGender").value=p.gender||"";$("#productOffer").value=p.isDonation?"donation":"sale";
  state.editPhoto=p.photo||"";$("#photoPreview").innerHTML=p.photo?`<img src="${p.photo}" alt="">`:"Sem foto";
  syncProductCatalogFields();
};
window.labelProduct=function(id){nav("etiqueta");$("#labelProduct").value=id;renderLabel()};
window.sellProduct=function(sku){nav("venda");$("#saleSku").value=sku;lookupSaleSku()};
async function fileToPhoto(file){if(!file)return null;return new Promise(resolve=>{const reader=new FileReader();reader.onload=e=>{const img=new Image();img.onload=()=>{const max=720,scale=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement("canvas");c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext("2d").drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL("image/jpeg",.72))};img.onerror=()=>resolve(e.target.result);img.src=e.target.result};reader.readAsDataURL(file)})}
async function saveProduct(e){
  e.preventDefault();if(state.productSaving)return;
  const id=$("#productId").value,existing=state.products.find(x=>x.id===id),category=$("#productCategory").value,mode=$("#productMode").value;
  const product={id:existing?.id||uid("prd"),sku:existing?.sku||nextSku(category),name:$("#productName").value.trim(),category,brand:$("#productBrand").value.trim(),size:$("#productSize").value.trim(),color:$("#productColor").value.trim(),condition:$("#productCondition").value,mode,owner:$("#productOwner").value.trim(),ownerPhone:$("#productOwnerPhone").value.trim(),price:Number($("#productPrice").value),discountPercent:Number($("#productDiscount")?.value||0),qty:Number($("#productQty").value),expectedQty:existing?Number($("#productForm").dataset.expectedQty):null,cost:Number($("#productCost").value||0),photo:state.editPhoto||existing?.photo||"",stockType:MULTI_CATEGORIES.has(category)?"Múltiplas unidades":"Peça única",createdAt:existing?.createdAt||nowISO(),updatedAt:nowISO()};
  product.active=existing?.active!==false;
  product.catalogSection=$("#productCatalogSection").value;
  product.ageGroup=product.catalogSection==="vestuario"?$("#productAgeGroup").value:"";
  product.gender=product.catalogSection==="vestuario"?$("#productGender").value:"";
  product.isDonation=product.catalogSection==="vestuario"&&$("#productOffer").value==="donation";
  if(product.isDonation){product.price=0;product.discountPercent=0;product.mode="proprio"}
  if(!product.name||!product.owner||!Number.isFinite(product.price)||(!product.isDonation&&product.price<=0)||!Number.isInteger(product.qty)||product.qty<0||product.cost<0||product.discountPercent<0||product.discountPercent>50){toast("Confira os campos obrigatórios e o desconto de 0% a 50%.");return}
  if(product.catalogSection==="vestuario"&&(!product.ageGroup||!product.gender||!product.size)){toast("Informe público, modelo e tamanho da peça.");return}
  state.productSaving=true;const button=$("#saveProductButton"),label=button.textContent;
  button.disabled=true;button.textContent=existing?"Atualizando produto...":"Cadastrando produto...";
  try{
    if(window.tudoTalCloud?.saveProductAdmin)await window.tudoTalCloud.saveProductAdmin(product);else await dbPut("products",product);
    await loadState();$("#productId").value="";toast((existing?"Produto atualizado: ":"Produto cadastrado: ")+product.sku);nav("produtos");
  }catch(err){
    console.error("Salvar produto",err);
    if(window.tudoTalCloud?.syncAndRefresh)await window.tudoTalCloud.syncAndRefresh().catch(()=>{});
    const msg=String(err?.message||"Não consegui salvar o produto.");
    toast(/estoque mudou/i.test(msg)?msg:"Não consegui salvar: "+msg.slice(0,95));
  }finally{state.productSaving=false;button.disabled=false;button.textContent=label}
}
