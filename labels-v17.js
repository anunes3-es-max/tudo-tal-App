"use strict";

/* Tudo & Tal — Etiquetas v17 */
let currentLabelMode=localStorage.getItem("tudoTalLabelMode")||"produto";

function label17Clamp(value,min,max,fallback){
  const n=Number(value);
  return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;
}
function label17Settings(){
  const gap=label17Clamp(document.querySelector("#labelGap")?.value,0,20,3);
  return {width:50,height:50,gap,total:50+gap};
}
function label17Setup(){
  const gap=document.querySelector("#labelGap");
  const saved=localStorage.getItem("tudoTalLabelGap");
  if(gap&&saved!==null)gap.value=saved;
  if(gap&&!gap.dataset.v17){
    gap.dataset.v17="1";
    gap.addEventListener("input",function(){
      localStorage.setItem("tudoTalLabelGap",String(label17Settings().gap));
    });
  }
  document.querySelectorAll("#labelModeTabs [data-label-mode]").forEach(function(btn){
    if(btn.dataset.v17)return;
    btn.dataset.v17="1";
    btn.addEventListener("click",function(){
      currentLabelMode=btn.dataset.labelMode;
      localStorage.setItem("tudoTalLabelMode",currentLabelMode);
      renderLabel();
    });
  });
  const ios=document.querySelector("#printIosXdLabelBtn");
  if(ios&&!ios.dataset.v19){
    ios.dataset.v19="1";
    ios.addEventListener("click",printIosXdLabel);
  }
}

function label17QrSvg(payload,x,y,moduleSize){
  const m=TudoTalQR.makeMatrix(payload);
  const total=(m.length+8)*moduleSize;
  let out='<rect x="'+x+'" y="'+y+'" width="'+total+'" height="'+total+'" fill="#fff"/>';
  out+='<g fill="#050608" shape-rendering="crispEdges">';
  for(let yy=0;yy<m.length;yy++){
    for(let xx=0;xx<m.length;xx++){
      if(m[yy][xx]){
        out+='<rect x="'+(x+(xx+4)*moduleSize)+'" y="'+(y+(yy+4)*moduleSize)+'" width="'+moduleSize+'" height="'+moduleSize+'"/>';
      }
    }
  }
  return out+"</g>";
}

function label17NameLines(name,maxChars){
  const words=String(name||"Produto").trim().split(/\s+/);
  const lines=[""];
  for(const word of words){
    const i=lines.length-1;
    const trial=(lines[i]+" "+word).trim();
    if(trial.length<=maxChars||!lines[i])lines[i]=trial;
    else if(lines.length<2)lines.push(word);
    else{
      lines[1]=(lines[1]+" "+word).trim().slice(0,maxChars+4);
      break;
    }
  }
  return lines.slice(0,2);
}

function label17ProductSvg(p){
  if(!p){
    return '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 400 400"><rect width="400" height="400" fill="#fff"/><text x="200" y="205" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" fill="#777">Cadastre um produto</text></svg>';
  }
  const lines=label17NameLines(p.name,25).map(esc);
  const name=lines.length===1
    ? '<text x="200" y="61" text-anchor="middle" font-family="Arial,sans-serif" font-size="29" font-weight="800" fill="#15161c">'+lines[0]+'</text>'
    : '<text x="200" y="48" text-anchor="middle" font-family="Arial,sans-serif" font-size="23" font-weight="800" fill="#15161c">'+lines[0]+'</text><text x="200" y="74" text-anchor="middle" font-family="Arial,sans-serif" font-size="23" font-weight="800" fill="#15161c">'+lines[1]+'</text>';
  const matrix=TudoTalQR.makeMatrix(p.sku);
  const moduleSize=9;
  const qrTotal=(matrix.length+8)*moduleSize;
  const qrX=Math.round((400-qrTotal)/2);
  const qrY=92;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 400 400">',
    '<rect width="400" height="400" fill="#fff"/>',
    '<rect x="7" y="7" width="386" height="386" rx="17" fill="none" stroke="#dfe1e8" stroke-width="2"/>',
    '<text x="200" y="22" text-anchor="middle" font-family="Arial,sans-serif" font-size="8.5" font-weight="800" letter-spacing="2" fill="#777a87">TUDO &amp; TAL · BRECHÓ</text>',
    '<rect x="135" y="29" width="54" height="2.5" rx="1.25" fill="#e94b7c"/>',
    '<rect x="211" y="29" width="54" height="2.5" rx="1.25" fill="#7857e8"/>',
    name,
    label17QrSvg(p.sku,qrX,qrY,moduleSize),
    '<text x="106" y="371" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="800" letter-spacing="1.4" fill="#777a87">TAMANHO</text>',
    '<text x="294" y="371" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="800" letter-spacing="1.4" fill="#777a87">PREÇO</text>',
    '<text x="106" y="389" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="750" fill="#15161c">'+esc(p.size||"—")+'</text>',
    '<text x="294" y="389" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="750" fill="#15161c">'+esc(money(p.price))+'</text>',
    '<rect x="199" y="365" width="2" height="24" rx="1" fill="#dfe1e8"/>',
    '</svg>'
  ].join("");
}

function label17GratitudeSquareSvg(){
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 400 400">',
    '<defs><linearGradient id="sqA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e94b7c"/><stop offset="1" stop-color="#7857e8"/></linearGradient></defs>',
    '<rect width="400" height="400" fill="#f7f7fa"/>',
    '<rect x="10" y="10" width="380" height="380" rx="24" fill="none" stroke="#15161c" stroke-width="3"/>',
    '<path d="M10 104V34Q10 10 34 10h88" fill="none" stroke="url(#sqA)" stroke-width="5"/>',
    '<path d="M390 296v70q0 24-24 24h-88" fill="none" stroke="url(#sqA)" stroke-width="5"/>',
    '<text x="200" y="73" text-anchor="middle" font-family="Georgia,serif" font-size="30" font-weight="650" fill="#15161c">Tudo <tspan fill="#e94b7c">&amp;</tspan> Tal</text>',
    '<text x="200" y="94" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="800" letter-spacing="4" fill="#777a87">BRECHÓ</text>',
    '<rect x="116" y="122" width="168" height="5" rx="2.5" fill="url(#sqA)"/>',
    '<text x="200" y="207" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="850" fill="#15161c">Agradecemos</text>',
    '<text x="200" y="252" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="850" fill="#15161c">a preferência!</text>',
    '<text x="200" y="309" text-anchor="middle" font-family="Arial,sans-serif" font-size="10.5" font-weight="850" letter-spacing="2" fill="#777a87">OBRIGADO POR ESCOLHER A GENTE</text>',
    '<rect x="122" y="336" width="156" height="3" rx="1.5" fill="#1a1d27"/>',
    '<rect x="166" y="336" width="68" height="3" rx="1.5" fill="url(#sqA)"/>',
    '</svg>'
  ].join("");
}

function label17GratitudeRoundSvg(){
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 400 400">',
    '<defs><linearGradient id="rdA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e94b7c"/><stop offset="1" stop-color="#7857e8"/></linearGradient></defs>',
    '<rect width="400" height="400" fill="#fff"/>',
    '<circle cx="200" cy="200" r="190" fill="#f7f7fa" stroke="#15161c" stroke-width="4"/>',
    '<circle cx="200" cy="200" r="179" fill="none" stroke="url(#rdA)" stroke-width="5"/>',
    '<path d="M90 101A149 149 0 0 1 310 101" fill="none" stroke="#dfe1e8" stroke-width="2"/>',
    '<path d="M90 299A149 149 0 0 0 310 299" fill="none" stroke="#dfe1e8" stroke-width="2"/>',
    '<text x="200" y="90" text-anchor="middle" font-family="Georgia,serif" font-size="29" font-weight="650" fill="#15161c">Tudo <tspan fill="#e94b7c">&amp;</tspan> Tal</text>',
    '<text x="200" y="111" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="800" letter-spacing="4" fill="#777a87">BRECHÓ</text>',
    '<rect x="124" y="133" width="152" height="5" rx="2.5" fill="url(#rdA)"/>',
    '<text x="200" y="208" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="850" fill="#15161c">Agradecemos</text>',
    '<text x="200" y="249" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="850" fill="#15161c">a preferência!</text>',
    '<text x="200" y="292" text-anchor="middle" font-family="Arial,sans-serif" font-size="9.5" font-weight="850" letter-spacing="2" fill="#777a87">TUDO &amp; TAL · SEGUNDA VIDA</text>',
    '</svg>'
  ].join("");
}

function label17CurrentSvg(){
  if(currentLabelMode==="gratidao-quadrada")return label17GratitudeSquareSvg();
  if(currentLabelMode==="gratidao-redonda")return label17GratitudeRoundSvg();
  const p=state.products.find(function(x){return x.id===document.querySelector("#labelProduct")?.value})||state.products[0];
  return label17ProductSvg(p);
}
function label17FileName(){
  if(currentLabelMode==="gratidao-quadrada")return"Etiqueta_Gratidao_Quadrada_50x50mm";
  if(currentLabelMode==="gratidao-redonda")return"Etiqueta_Gratidao_Redonda_50x50mm";
  const p=state.products.find(function(x){return x.id===document.querySelector("#labelProduct")?.value})||state.products[0];
  return"Etiqueta_Produto_"+(p?.sku||"TudoTal")+"_50x50mm";
}

function renderLabelOptions(){
  label17Setup();
  const sel=document.querySelector("#labelProduct");
  const current=sel?.value;
  if(sel){
    sel.innerHTML=[...state.products].sort(function(a,b){return a.name.localeCompare(b.name,"pt-BR")}).map(function(p){
      return'<option value="'+p.id+'">'+esc(p.name)+' — '+esc(p.sku)+'</option>';
    }).join("");
    if(current&&state.products.some(function(p){return p.id===current}))sel.value=current;
  }
  renderLabel();
}
function renderLabel(){
  label17Setup();
  document.querySelectorAll("#labelModeTabs [data-label-mode]").forEach(function(btn){
    btn.classList.toggle("active",btn.dataset.labelMode===currentLabelMode);
  });
  const controls=document.querySelector("#productLabelControls");
  if(controls)controls.classList.toggle("hidden",currentLabelMode!=="produto");
  const help=document.querySelector("#labelModeHelp");
  if(help){
    help.innerHTML=currentLabelMode==="produto"
      ? '<strong>QR em primeiro lugar.</strong><span>Área branca ampla em volta do código para leitura rápida pela câmera do celular e pelo leitor 2D.</span>'
      : '<strong>Gratidão 5 × 5 cm.</strong><span>Visual fashion-tech do app, sem florais e sem elementos infantis. O PNG preserva as cores.</span>';
  }
  const preview=document.querySelector("#labelPreview");
  if(!preview)return;
  preview.className=currentLabelMode==="gratidao-redonda"?"label-square round-label-preview":"label-square";
  preview.innerHTML=label17CurrentSvg();
}
function printLabel(){
  const s=label17Settings();
  let style=document.querySelector("#dynamicPrintStyle");
  if(!style){
    style=document.createElement("style");
    style.id="dynamicPrintStyle";
    document.head.appendChild(style);
  }
  style.textContent='@media print{@page{size:50mm '+s.total+'mm;margin:0}#labelPreview{width:50mm!important;height:50mm!important;display:block!important;margin:0!important;border:0!important;box-shadow:none!important}#labelPreview svg{width:50mm!important;height:50mm!important;display:block!important}}';
  window.print();
}

function label17SvgToCanvas(svg,width,height){
  return new Promise(function(resolve,reject){
    const blob=new Blob([svg],{type:"image/svg+xml;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const img=new Image();
    img.onload=function(){
      try{
        const c=document.createElement("canvas");
        c.width=width;c.height=height;
        const ctx=c.getContext("2d");
        ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);
        ctx.imageSmoothingEnabled=false;
        ctx.drawImage(img,0,0,width,height);
        URL.revokeObjectURL(url);
        resolve(c);
      }catch(e){URL.revokeObjectURL(url);reject(e)}
    };
    img.onerror=function(e){URL.revokeObjectURL(url);reject(e)};
    img.src=url;
  });
}
async function downloadLabel(){
  try{
    const c=await label17SvgToCanvas(label17CurrentSvg(),1200,1200);
    c.toBlob(function(blob){
      if(!blob)return;
      const a=document.createElement("a");
      a.href=URL.createObjectURL(blob);
      a.download=label17FileName()+".png";
      a.click();
      setTimeout(function(){URL.revokeObjectURL(a.href)},1500);
    },"image/png",1);
  }catch(err){
    console.error(err);
    toast("Não consegui gerar o PNG da etiqueta.");
  }
}

function label17DrawQr(ctx,payload,x,y,moduleSize){
  const m=TudoTalQR.makeMatrix(payload);
  const total=(m.length+8)*moduleSize;
  ctx.fillStyle="#fff";ctx.fillRect(x,y,total,total);
  ctx.fillStyle="#000";
  for(let yy=0;yy<m.length;yy++){
    for(let xx=0;xx<m.length;xx++){
      if(m[yy][xx])ctx.fillRect(x+(xx+4)*moduleSize,y+(yy+4)*moduleSize,moduleSize,moduleSize);
    }
  }
}
function label17FitText(ctx,text,maxWidth,startSize,minSize,weight){
  let size=startSize;
  while(size>minSize){
    ctx.font=weight+" "+size+"px Arial";
    if(ctx.measureText(text).width<=maxWidth)break;
    size--;
  }
  return size;
}
function label17ProductThermalCanvas(p){
  const c=document.createElement("canvas");
  c.width=384;c.height=400;
  const ctx=c.getContext("2d");
  ctx.imageSmoothingEnabled=false;
  ctx.fillStyle="#fff";ctx.fillRect(0,0,384,400);
  ctx.textAlign="center";
  ctx.fillStyle="#111";ctx.font="700 9px Arial";
  ctx.fillText("TUDO & TAL · BRECHÓ",192,16);

  const lines=label17NameLines(p?.name||"Produto",24);
  ctx.fillStyle="#000";
  if(lines.length===1){
    const sz=label17FitText(ctx,lines[0],344,27,18,800);
    ctx.font="800 "+sz+"px Arial";
    ctx.fillText(lines[0],192,51);
  }else{
    const s1=label17FitText(ctx,lines[0],344,22,16,800);
    const s2=label17FitText(ctx,lines[1],344,22,16,800);
    ctx.font="800 "+s1+"px Arial";ctx.fillText(lines[0],192,39);
    ctx.font="800 "+s2+"px Arial";ctx.fillText(lines[1],192,64);
  }
  const m=TudoTalQR.makeMatrix(p?.sku||"TDT");
  const moduleSize=8;
  const total=(m.length+8)*moduleSize;
  const x=Math.round((384-total)/2);
  label17DrawQr(ctx,p?.sku||"TDT",x,88,moduleSize);

  ctx.fillStyle="#555";ctx.font="700 7px Arial";
  ctx.fillText("TAMANHO",96,365);ctx.fillText("PREÇO",288,365);
  ctx.fillStyle="#000";ctx.font="700 13px Arial";
  ctx.fillText(p?.size||"—",96,383);ctx.fillText(money(p?.price||0),288,383);
  return c;
}
async function label17CurrentThermalCanvas(){
  if(currentLabelMode==="produto"){
    const p=state.products.find(function(x){return x.id===document.querySelector("#labelProduct")?.value})||state.products[0];
    if(!p)throw new Error("Selecione um produto.");
    return label17ProductThermalCanvas(p);
  }
  const src=await label17SvgToCanvas(label17CurrentSvg(),384,384);
  const c=document.createElement("canvas");
  c.width=384;c.height=400;
  const ctx=c.getContext("2d");
  ctx.fillStyle="#fff";ctx.fillRect(0,0,384,400);
  ctx.drawImage(src,0,8);
  return c;
}
function label17EscPosRaster(canvas,gapMm){
  const ctx=canvas.getContext("2d");
  const w=canvas.width,h=canvas.height;
  const data=ctx.getImageData(0,0,w,h).data;
  const widthBytes=Math.ceil(w/8);
  const raster=new Uint8Array(widthBytes*h);
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      const a=data[i+3]/255;
      const r=255-(255-data[i])*a;
      const g=255-(255-data[i+1])*a;
      const b=255-(255-data[i+2])*a;
      const lum=.2126*r+.7152*g+.0722*b;
      if(lum<175)raster[y*widthBytes+(x>>3)]|=0x80>>(x&7);
    }
  }
  const gapDots=Math.max(0,Math.min(255,Math.round(Number(gapMm||0)*8)));
  const header=[0x1b,0x40,0x1b,0x61,0x01,0x1d,0x76,0x30,0x00,widthBytes&255,(widthBytes>>8)&255,h&255,(h>>8)&255];
  const footer=gapDots?[0x1b,0x4a,gapDots]:[];
  const out=new Uint8Array(header.length+raster.length+footer.length);
  out.set(header,0);out.set(raster,header.length);out.set(footer,header.length+raster.length);
  return out;
}
function label17Base64(bytes){
  let binary="";
  const chunk=8192;
  for(let i=0;i<bytes.length;i+=chunk){
    const part=bytes.subarray(i,Math.min(i+chunk,bytes.length));
    binary+=String.fromCharCode.apply(null,part);
  }
  return btoa(binary);
}
async function printPt260Android(){
  if(!/Android/i.test(navigator.userAgent)){
    toast("PT260 direta está preparada para Android. No iPhone use “Imprimir pelo sistema”.");
    return;
  }
  const btn=document.querySelector("#printPt260Btn");
  const old=btn?.innerHTML;
  if(btn){btn.disabled=true;btn.textContent="Preparando PT260..."}
  try{
    const canvas=await label17CurrentThermalCanvas();
    const bytes=label17EscPosRaster(canvas,label17Settings().gap);
    const url="rawbt:base64,"+label17Base64(bytes);
    toast("Enviando para a PT260…");
    setTimeout(function(){location.href=url},80);
    setTimeout(function(){toast("Se o RawBT não abriu, instale/configure o serviço uma vez e tente novamente.")},1800);
  }catch(err){
    console.error(err);
    toast("Não consegui preparar a PT260: "+String(err?.message||"erro").slice(0,80));
  }finally{
    setTimeout(function(){if(btn){btn.disabled=false;btn.innerHTML=old}},600);
  }
}


function label17CanvasBlob(canvas){
  return new Promise(function(resolve,reject){
    canvas.toBlob(function(blob){
      if(blob)resolve(blob);
      else reject(new Error("Falha ao gerar a imagem."));
    },"image/png",1);
  });
}

async function printIosXdLabel(){
  const btn=document.querySelector("#printIosXdLabelBtn");
  const old=btn?.innerHTML;
  if(btn){btn.disabled=true;btn.textContent="Gerando PNG 5 × 5..."}
  try{
    const canvas=await label17SvgToCanvas(label17CurrentSvg(),1200,1200);
    const blob=await label17CanvasBlob(canvas);
    const filename=label17FileName()+".png";
    const file=new File([blob],filename,{type:"image/png"});

    if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
      await navigator.share({
        files:[file],
        title:"Etiqueta Tudo & Tal",
        text:"Salve esta etiqueta no iPhone. Depois abra o XDLabel Studio e importe a imagem salva."
      });
      toast("Salve a imagem no iPhone. Depois abra o XDLabel Studio e adicione a imagem pela galeria/arquivos.");
      return;
    }

    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){URL.revokeObjectURL(a.href)},1800);
    toast("PNG salvo. Agora abra o XDLabel Studio e adicione a imagem pela galeria/arquivos.");
  }catch(err){
    if(err?.name==="AbortError")return;
    console.error(err);
    toast("Não consegui salvar pelo compartilhamento. Use “Baixar PNG” e importe a imagem no XDLabel Studio.");
  }finally{
    if(btn){btn.disabled=false;btn.innerHTML=old}
  }
}
