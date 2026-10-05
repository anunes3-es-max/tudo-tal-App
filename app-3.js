function parseScannedValue(raw){try{const u=new URL(raw),s=u.searchParams.get("sku");if(s)return s.toUpperCase()}catch(_){}return String(raw||"").trim().toUpperCase()}
function renderSaleLookup(){const sku=$("#saleSku").value.trim();if(sku)lookupSaleSku();else $("#saleProductCard").innerHTML=`<div class="empty">Leia o QR ou digite o SKU.</div>`}
function lookupSaleSku(){const sku=parseScannedValue($("#saleSku").value);$("#saleSku").value=sku;const p=state.products.find(x=>String(x.sku).toUpperCase()===sku);state.currentSaleProduct=p||null;if(!p){$("#saleProductCard").innerHTML=sku?`<div class="panel"><strong>SKU não encontrado.</strong><div class="meta">${esc(sku)}</div></div>`:"";return}const rate=p.mode==="consignado"?commissionRate(p.price):0;$("#saleProductCard").innerHTML=`<div class="sale-card"><h2>${esc(p.name)}</h2><div class="meta">${esc(p.sku)} • ${esc(p.owner)} • ${esc(p.size||"Sem tamanho")}</div><div class="sale-grid"><div><span>Preço</span><strong>${money(p.price)}</strong></div><div><span>Estoque</span><strong>${p.qty}</strong></div><div><span>Modalidade</span><strong>${p.mode==="consignado"?"Consignado":"Próprio"}</strong></div><div><span>Comissão</span><strong>${p.mode==="consignado"?`${Math.round(rate*100)}%`:"—"}</strong></div></div><div class="two"><label>Quantidade<input id="saleQty" class="input" type="number" min="1" max="${p.qty}" value="1"></label><label>Preço unitário<input id="salePrice" class="input" type="number" min="0.01" step="0.01" value="${Number(p.price).toFixed(2)}"></label></div><div class="two"><label>Pagamento<select id="salePayment" class="input"><option>Pix</option><option>Dinheiro</option><option>Cartão débito</option><option>Cartão crédito</option><option>Transferência</option><option>Outro</option></select></label><label>Canal<select id="saleChannel" class="input"><option>Loja física</option><option>Instagram</option><option>WhatsApp</option><option>Indicação</option><option>Outro</option></select></label></div><button class="primary wide" onclick="confirmSale()">Confirmar venda</button></div>`}
window.confirmSale=async function(){const p=state.currentSaleProduct;if(!p)return;const qty=Number($("#saleQty").value),unit=Number($("#salePrice").value);if(qty<1||qty>p.qty){toast("Quantidade sem estoque disponível.");return}if(unit<=0){toast("Preço inválido.");return}const total=qty*unit,rate=p.mode==="consignado"?commissionRate(unit):0,commission=p.mode==="consignado"?total*rate:0,repasse=p.mode==="consignado"?total-commission:0,costTotal=p.mode==="proprio"?qty*Number(p.cost||0):0,result=p.mode==="proprio"?total-costTotal:commission,sale={id:uid("ven"),date:nowISO(),sku:p.sku,productId:p.id,productName:p.name,qty,unitPrice:unit,total,commissionRate:rate,commission,repasse,mode:p.mode,owner:p.owner,ownerPhone:p.ownerPhone||"",payment:$("#salePayment").value,channel:$("#saleChannel").value,receivedStatus:"Recebido",repasseStatus:p.mode==="consignado"?"Pendente":"Não aplicável",costTotal,result};p.qty-=qty;p.updatedAt=nowISO();await dbPut("products",p);await dbPut("sales",sale);await loadState();state.currentSaleProduct=null;$("#saleSku").value="";$("#saleProductCard").innerHTML="";toast(`Venda registrada: ${money(total)}`);nav("dashboard")};

function clampLabelNumber(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback}
function getLabelSettings(){
  const height=clampLabelNumber($("#labelHeight")?.value,50,100,60);
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

function qrGroupSvg(payload,x,y,module=7){
  const m=TudoTalQR.makeMatrix(payload),total=(21+8)*module;
  let s=`<rect x="${x}" y="${y}" width="${total}" height="${total}" fill="#fff"/><g fill="#000" shape-rendering="crispEdges">`;
  for(let yy=0;yy<m.length;yy++)for(let xx=0;xx<m.length;xx++)if(m[yy][xx]){
    s+=`<rect x="${x+(xx+4)*module}" y="${y+(yy+4)*module}" width="${module}" height="${module}"/>`;
  }
  return s+"</g>";
}

function labelSvg(p,heightMm=60,gapMm=3){
  if(!p)return"";
  const pxPerMm=8,widthPx=400,contentPx=Math.round(heightMm*pxPerMm),gapPx=Math.round(gapMm*pxPerMm),totalPx=contentPx+gapPx;
  const module=7,qrPx=(21+8)*module,qrX=Math.round((widthPx-qrPx)/2),qrY=Math.max(210,contentPx-qrPx-24);
  const safeName=esc(p.name).slice(0,31),safeSize=esc(p.size||"-"),safeSku=esc(p.sku);
  const price=money(p.price);
  return`<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="${heightMm+gapMm}mm" viewBox="0 0 ${widthPx} ${totalPx}" shape-rendering="crispEdges">
    <rect width="${widthPx}" height="${totalPx}" fill="#fff"/>
    <g fill="#111">
      <text x="200" y="38" text-anchor="middle" font-family="Georgia,serif" font-size="30" font-weight="700">Tudo &amp; Tal</text>
      <text x="200" y="58" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" letter-spacing="3">BRECHÓ</text>
      <text x="200" y="100" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700">${safeName}</text>
      <text x="200" y="132" text-anchor="middle" font-family="Arial,sans-serif" font-size="18">Tam.: ${safeSize}</text>
      <text x="200" y="176" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700">${price}</text>
      <text x="200" y="205" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="700">${safeSku}</text>
    </g>
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

function drawQrCanvas(ctx,payload,x,y,module=7){
  const m=TudoTalQR.makeMatrix(payload),total=(21+8)*module;
  ctx.fillStyle="#fff";ctx.fillRect(x,y,total,total);ctx.fillStyle="#000";
  for(let yy=0;yy<m.length;yy++)for(let xx=0;xx<m.length;xx++)if(m[yy][xx]){
    ctx.fillRect(x+(xx+4)*module,y+(yy+4)*module,module,module);
  }
}

function downloadLabel(){
  const p=state.products.find(x=>x.id===$("#labelProduct").value)||state.products[0];if(!p)return;
  const s=getLabelSettings(),pxPerMm=8,widthPx=400,contentPx=Math.round(s.height*pxPerMm),gapPx=Math.round(s.gap*pxPerMm),totalPx=contentPx+gapPx;
  const c=document.createElement("canvas");c.width=widthPx;c.height=totalPx;
  const ctx=c.getContext("2d");ctx.imageSmoothingEnabled=false;ctx.fillStyle="#fff";ctx.fillRect(0,0,widthPx,totalPx);
  ctx.fillStyle="#111";ctx.textAlign="center";
  ctx.font="700 30px Georgia";ctx.fillText("Tudo & Tal",200,38);
  ctx.font="700 11px Arial";ctx.fillText("B R E C H Ó",200,58);
  ctx.font="700 24px Arial";ctx.fillText(String(p.name||"").slice(0,31),200,100);
  ctx.font="18px Arial";ctx.fillText("Tam.: "+(p.size||"-"),200,132);
  ctx.font="700 34px Arial";ctx.fillText(money(p.price),200,176);
  ctx.font="700 15px Arial";ctx.fillText(p.sku,200,205);
  const module=7,qrPx=(21+8)*module,qrX=Math.round((widthPx-qrPx)/2),qrY=Math.max(210,contentPx-qrPx-24);
  drawQrCanvas(ctx,p.sku,qrX,qrY,module);
  c.toBlob(b=>{
    const a=document.createElement("a");a.href=URL.createObjectURL(b);
    a.download=`Etiqueta_${p.sku}_50x${s.height}mm_gap${s.gap}mm_PT260.png`;
    a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500)
  },"image/png",1);
}