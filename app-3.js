function parseScannedValue(raw){try{const u=new URL(raw),s=u.searchParams.get("sku");if(s)return s.toUpperCase()}catch(_){}return String(raw||"").trim().toUpperCase()}
function renderSaleLookup(){const sku=$("#saleSku").value.trim();if(sku)lookupSaleSku();else $("#saleProductCard").innerHTML=`<div class="empty">Leia o QR com a câmera/leitor 2D ou digite o SKU.</div>`;setTimeout(()=>$("#saleSku")?.focus(),120)}
function updatePaymentFields(){
  const payment=$("#salePayment")?.value||"Pix";
  const box=$("#paymentExtraFields");
  if(!box)return;
  if(payment==="Crédito parcelado"){
    box.classList.remove("hidden");
    box.innerHTML=`<div class="two"><label>Número de parcelas<input id="saleInstallments" class="input" type="number" min="2" max="24" value="2"></label><label>Resumo<input class="input" value="Parcelamento no cartão" disabled></label></div>`;
  }else if(payment==="Crediário VIP"){
    box.classList.remove("hidden");
    box.innerHTML=`<div class="two"><label>Número de parcelas<input id="saleInstallments" class="input" type="number" min="1" max="24" value="1"></label><label>Vencimento da 1ª parcela<input id="saleFirstDueDate" class="input" type="date" required></label></div><p class="hint">As próximas parcelas serão mensais. Cada parcela ficará no controle do Crediário VIP até ser marcada como paga.</p>`;
  }else{
    box.classList.add("hidden");
    box.innerHTML="";
  }
}

function lookupSaleSku(){
  const sku=parseScannedValue($("#saleSku").value);
  $("#saleSku").value=sku;
  const p=state.products.find(x=>String(x.sku).toUpperCase()===sku);
  state.currentSaleProduct=p||null;
  if(!p){
    $("#saleProductCard").innerHTML=sku?`<div class="panel"><strong>SKU não encontrado.</strong><div class="meta">${esc(sku)}</div></div>`:"";
    return;
  }
  const rate=p.mode==="consignado"?commissionRate(p.price):0;
  $("#saleProductCard").innerHTML=`<div class="sale-card">
    <h2>${esc(p.name)}</h2>
    <div class="meta">${esc(p.sku)} • ${esc(p.owner)} • ${esc(p.size||"Sem tamanho")}</div>
    <div class="sale-grid">
      <div><span>Preço</span><strong>${money(p.price)}</strong></div>
      <div><span>Estoque</span><strong>${p.qty}</strong></div>
      <div><span>Modalidade</span><strong>${p.mode==="consignado"?"Consignado":"Próprio"}</strong></div>
      <div><span>Comissão</span><strong>${p.mode==="consignado"?Math.round(rate*100)+"%":"—"}</strong></div>
    </div>
    <div class="two">
      <label>Quantidade<input id="saleQty" class="input" type="number" min="1" max="${p.qty}" value="1"></label>
      <label>Preço unitário<input id="salePrice" class="input" type="number" min="0.01" step="0.01" value="${Number(p.price).toFixed(2)}"></label>
    </div>
    <div class="two">
      <label>Pagamento
        <select id="salePayment" class="input" onchange="updatePaymentFields()">
          <option>Pix</option>
          <option>Dinheiro</option>
          <option>Débito</option>
          <option>Crédito à vista</option>
          <option>Crédito parcelado</option>
          <option>Crediário VIP</option>
        </select>
      </label>
      <label>Canal
        <select id="saleChannel" class="input">
          <option>Loja física</option><option>Instagram</option><option>WhatsApp</option><option>Indicação</option><option>Outro</option>
        </select>
      </label>
    </div>
    <div id="paymentExtraFields" class="payment-extra hidden"></div>
    <div class="two">
      <label>Tipo de cliente
        <select id="saleCustomerType" class="input">
          <option value="nao_informado">Não informado</option><option value="novo">Cliente novo</option><option value="recorrente">Cliente recorrente</option>
        </select>
      </label>
      <label>Perfil da compra
        <select id="salePurchaseProfile" class="input">
          <option value="nao_informado">Não informado</option><option value="uso_proprio">Uso próprio</option><option value="presente">Presente</option><option value="revenda">Revenda</option><option value="outro">Outro</option>
        </select>
      </label>
    </div>
    <p class="hint">Forma de pagamento, tipo de cliente e perfil da compra alimentam os relatórios financeiros e de mercado.</p>
    <p class="hint">🔒 A venda é confirmada na nuvem antes de baixar o estoque, evitando venda dupla entre aparelhos.</p>
    <button class="primary wide" onclick="confirmSale()">Confirmar venda</button>
  </div>`;
  updatePaymentFields();
}
window.confirmSale=async function(){
  const p=state.currentSaleProduct;if(!p)return;
  const qty=Number($("#saleQty").value),unit=Number($("#salePrice").value),payment=$("#salePayment").value,installments=Number($("#saleInstallments")?.value||1),firstDueDate=$("#saleFirstDueDate")?.value||null;
  if(qty<1||qty>p.qty){toast("Quantidade sem estoque disponível.");return}
  if(unit<=0){toast("Preço inválido.");return}\n  if(payment==="Crédito parcelado"&&installments<2){toast("Informe pelo menos 2 parcelas.");return}\n  if(payment==="Crediário VIP"&&!firstDueDate){toast("Informe o vencimento da primeira parcela do Crediário VIP.");return}
  if(!window.tudoTalCloud?.registerSaleAtomic){toast("Atualize o app antes de registrar a venda.");return}
  if(navigator.onLine===false){toast("Venda segura requer internet para confirmar o estoque.");return}

  const btn=$("#saleProductCard .primary");
  if(btn){btn.disabled=true;btn.textContent="Confirmando estoque..."}
  try{
    const result=await window.tudoTalCloud.registerSaleAtomic({
      saleId:uid("ven"),
      productId:p.id,
      qty,
      unitPrice:unit,
      payment:payment,\n      installments:installments,\n      firstDueDate:firstDueDate,
      channel:$("#saleChannel").value,
      customerType:$("#saleCustomerType").value,
      purchaseProfile:$("#salePurchaseProfile").value
    });
    await loadState();
    state.currentSaleProduct=null;
    $("#saleSku").value="";
    $("#saleProductCard").innerHTML="";
    toast(`Venda registrada com estoque protegido: ${money(result.sale.total)}`);
    nav("dashboard");
  }catch(err){
    const msg=String(err?.message||err||"Não consegui registrar a venda.");
    if(/estoque insuficiente/i.test(msg)){
      toast(msg);
      await window.tudoTalCloud.syncAndRefresh();
      const fresh=state.products.find(x=>x.id===p.id);
      if(fresh){state.currentSaleProduct=fresh;$("#saleSku").value=fresh.sku;lookupSaleSku()}
    }else if(/internet/i.test(msg)){
      toast("Sem internet. A venda não foi registrada para evitar conflito de estoque.");
    }else{
      console.error("Falha na venda atômica",err);
      toast("Não consegui registrar a venda: "+msg.slice(0,90));
    }
  }finally{
    const currentBtn=$("#saleProductCard .primary");
    if(currentBtn){currentBtn.disabled=false;currentBtn.textContent="Confirmar venda"}
  }
};

function clampLabelNumber(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback}
function getLabelSettings(){
  const height=clampLabelNumber($("#labelHeight")?.value,45,100,50);
  const gap=clampLabelNumber($("#labelGap")?.value,0,20,3);
  return {height,gap,total:height+gap};
}
function setupLabelSettings(){
  const savedHeight=localStorage.getItem("tudoTalLabelHeight");
  const savedGap=localStorage.getItem("tudoTalLabelGap");
  if(savedHeight)$("#labelHeight").value=savedHeight;
  if(savedGap)$("#labelGap").value=savedGap;
  ["labelHeight","labelGap"].forEach(id=>{
    const el=$("#"+id);
    if(!el||el.dataset.bound)return;
    el.dataset.bound="1";
    el.addEventListener("input",()=>{
      const s=getLabelSettings();
      localStorage.setItem("tudoTalLabelHeight",String(s.height));
      localStorage.setItem("tudoTalLabelGap",String(s.gap));
      renderLabel();
    });
  });
}

function qrGroupSvg(payload,x,y,module=9){
  const m=TudoTalQR.makeMatrix(payload),total=(21+8)*module;
  let s=`<rect x="${x}" y="${y}" width="${total}" height="${total}" fill="#fff"/><g fill="#000" shape-rendering="crispEdges">`;
  for(let yy=0;yy<m.length;yy++)for(let xx=0;xx<m.length;xx++)if(m[yy][xx]){
    s+=`<rect x="${x+(xx+4)*module}" y="${y+(yy+4)*module}" width="${module}" height="${module}"/>`;
  }
  return s+"</g>";
}

function labelNameLines(name){
  const words=String(name||"Produto").trim().split(/\s+/);
  const lines=[""];
  for(const word of words){
    const i=lines.length-1,trial=(lines[i]+" "+word).trim();
    if(trial.length<=23 || !lines[i]) lines[i]=trial;
    else if(lines.length<2) lines.push(word);
    else { lines[1]=(lines[1]+" "+word).trim().slice(0,26); break; }
  }
  return lines.slice(0,2);
}

function labelSvg(p,heightMm=50,gapMm=3){
  if(!p)return"";
  const pxPerMm=8,widthPx=400,contentPx=Math.round(heightMm*pxPerMm),gapPx=Math.round(gapMm*pxPerMm),totalPx=contentPx+gapPx;
  const module=9,qrPx=(21+8)*module,qrX=Math.round((widthPx-qrPx)/2),qrY=Math.max(108,contentPx-qrPx-20);
  const lines=labelNameLines(p.name).map(esc);
  const nameSvg=lines.length===1
    ? `<text x="200" y="64" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="700">${lines[0]}</text>`
    : `<text x="200" y="48" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-weight="700">${lines[0]}</text><text x="200" y="80" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-weight="700">${lines[1]}</text>`;
  return`<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="${heightMm+gapMm}mm" viewBox="0 0 ${widthPx} ${totalPx}" shape-rendering="crispEdges">
    <rect width="${widthPx}" height="${totalPx}" fill="#fff"/>
    <g fill="#111">${nameSvg}</g>
    ${qrGroupSvg(p.sku,qrX,qrY,module)}
  </svg>`;
}

function renderLabelOptions(){
  const sel=$("#labelProduct"),current=sel.value;
  setupLabelSettings();
  sel.innerHTML=[...state.products].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")).map(p=>`<option value="${p.id}">${esc(p.name)} — ${esc(p.sku)}</option>`).join("");
  if(current&&state.products.some(p=>p.id===current))sel.value=current;
  renderLabel();
}

function renderLabel(){
  const p=state.products.find(x=>x.id===$("#labelProduct").value)||state.products[0];
  const s=getLabelSettings();
  const preview=$("#labelPreview");
  preview.style.width="50mm";
  preview.style.height=s.total+"mm";
  preview.innerHTML=labelSvg(p,s.height,s.gap);
}

function printLabel(){
  const s=getLabelSettings();
  let style=$("#dynamicPrintStyle");
  if(!style){style=document.createElement("style");style.id="dynamicPrintStyle";document.head.appendChild(style)}
  style.textContent=`@media print{@page{size:50mm ${s.total}mm;margin:0}#labelPreview{width:50mm!important;height:${s.total}mm!important}}`;
  window.print();
}

function drawQrCanvas(ctx,payload,x,y,module=9){
  const m=TudoTalQR.makeMatrix(payload),total=(21+8)*module;
  ctx.fillStyle="#fff";ctx.fillRect(x,y,total,total);ctx.fillStyle="#000";
  for(let yy=0;yy<m.length;yy++)for(let xx=0;xx<m.length;xx++)if(m[yy][xx]){
    ctx.fillRect(x+(xx+4)*module,y+(yy+4)*module,module,module);
  }
}

function fitCanvasLabelText(ctx,text,maxWidth,startSize=28,minSize=19){
  let size=startSize;
  while(size>minSize){ctx.font=`700 ${size}px Arial`;if(ctx.measureText(text).width<=maxWidth)break;size--}
  return size;
}

function downloadLabel(){
  const p=state.products.find(x=>x.id===$("#labelProduct").value)||state.products[0];if(!p)return;
  const s=getLabelSettings(),pxPerMm=8,widthPx=400,contentPx=Math.round(s.height*pxPerMm),gapPx=Math.round(s.gap*pxPerMm),totalPx=contentPx+gapPx;
  const c=document.createElement("canvas");c.width=widthPx;c.height=totalPx;
  const ctx=c.getContext("2d");ctx.imageSmoothingEnabled=false;ctx.fillStyle="#fff";ctx.fillRect(0,0,widthPx,totalPx);
  const lines=labelNameLines(p.name);
  ctx.fillStyle="#111";ctx.textAlign="center";
  if(lines.length===1){
    const size=fitCanvasLabelText(ctx,lines[0],350,28,19);ctx.font=`700 ${size}px Arial`;ctx.fillText(lines[0],200,64);
  }else{
    const size1=fitCanvasLabelText(ctx,lines[0],350,25,18),size2=fitCanvasLabelText(ctx,lines[1],350,25,18);
    ctx.font=`700 ${size1}px Arial`;ctx.fillText(lines[0],200,48);
    ctx.font=`700 ${size2}px Arial`;ctx.fillText(lines[1],200,80);
  }
  const module=9,qrPx=(21+8)*module,qrX=Math.round((widthPx-qrPx)/2),qrY=Math.max(108,contentPx-qrPx-20);
  drawQrCanvas(ctx,p.sku,qrX,qrY,module);
  c.toBlob(b=>{
    const a=document.createElement("a");a.href=URL.createObjectURL(b);
    a.download=`Etiqueta_ID_${p.sku}_50x${s.height}mm_gap${s.gap}mm.png`;
    a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500)
  },"image/png",1);
}