"use strict";
const LOGO_THERMAL_B64="";
const CATEGORIES={"Moda Adulto":"ADU","Moda Infantil":"INF","Bolsas":"BOL","Calçados":"CAL","Beleza":"BEL","Perfumes":"PER","Skincare":"SKI","Cabelo":"CAB","Cuidado Pessoal":"CUI","Acessórios":"ACE","Achadinhos":"ACH","Outros":"OUT"};
const MULTI_CATEGORIES=new Set(["Beleza","Perfumes","Skincare","Cabelo","Cuidado Pessoal"]);
const DB_NAME="TudoTalDB",DB_VERSION=1;let db;
const state={products:[],sales:[],cash:[],view:"dashboard",editPhoto:null,currentSaleProduct:null};
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const money=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const nowISO=()=>new Date().toISOString(),uid=p=>`${p}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove("show"),2600)}
function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains("products"))d.createObjectStore("products",{keyPath:"id"});if(!d.objectStoreNames.contains("sales"))d.createObjectStore("sales",{keyPath:"id"});if(!d.objectStoreNames.contains("cash"))d.createObjectStore("cash",{keyPath:"id"});if(!d.objectStoreNames.contains("settings"))d.createObjectStore("settings",{keyPath:"key"})};req.onsuccess=()=>{db=req.result;resolve(db)};req.onerror=()=>reject(req.error)})}
function store(n,m="readonly"){return db.transaction(n,m).objectStore(n)}
function dbAll(n){return new Promise((res,rej)=>{const r=store(n).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
function localPut(n,o){return new Promise((res,rej)=>{const r=store(n,"readwrite").put(o);r.onsuccess=()=>res(o);r.onerror=()=>rej(r.error)})}
async function dbPut(n,o){
  if(!window.__TDT_CLOUD_APPLYING__&&(n==="products"||n==="sales"))o.updatedAt=nowISO();
  await localPut(n,o);
  if(!window.__TDT_CLOUD_APPLYING__&&window.tudoTalCloud?.upsert)await window.tudoTalCloud.upsert(n,o);
  return o;
}
function dbClear(n){return new Promise((res,rej)=>{const r=store(n,"readwrite").clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
async function loadState(){state.products=await dbAll("products");state.sales=await dbAll("sales");state.cash=await dbAll("cash")}
async function seed(){if(state.products.length)return;const p={id:uid("prd"),sku:"TDT-CUI-0001",name:"Máscara capilar",category:"Cuidado Pessoal",brand:"Fino",size:"230g",color:"",condition:"Novo",owner:"Tudo e Tal",ownerPhone:"",price:150,qty:3,cost:0,mode:"proprio",photo:"",stockType:"Múltiplas unidades",createdAt:nowISO(),updatedAt:nowISO()};await dbPut("products",p);state.products=[p]}
function commissionRate(price){const p=Number(price||0);if(p<=50)return .20;if(p<=100)return .25;if(p<=150)return .30;return .35}
function nextSku(category){const prefix=CATEGORIES[category]||"OUT";let max=0;for(const p of state.products){const m=String(p.sku||"").match(/-(\d{4})$/);if(m)max=Math.max(max,Number(m[1]))}return`TDT-${prefix}-${String(max+1).padStart(4,"0")}`}
function nav(view){state.view=view;$$(".view").forEach(v=>v.classList.toggle("active",v.id===`view-${view}`));$$(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.nav===view));window.scrollTo({top:0,behavior:"smooth"});if(view==="dashboard")renderDashboard();if(view==="produtos")renderProducts();if(view==="produto-form")prepareProductForm();if(view==="venda")renderSaleLookup();if(view==="etiqueta")renderLabelOptions();if(view==="repasses")renderRepasses();if(view==="caixa")renderCash()}
function renderDashboard(){const totalStock=state.products.reduce((s,p)=>s+Number(p.qty||0),0),stockValue=state.products.reduce((s,p)=>s+Number(p.qty||0)*Number(p.price||0),0),salesTotal=state.sales.reduce((s,x)=>s+Number(x.total||0),0),storeResult=state.sales.reduce((s,x)=>s+Number(x.result||0),0),pending=state.sales.filter(x=>x.mode==="consignado"&&x.repasseStatus==="Pendente").reduce((s,x)=>s+Number(x.repasse||0),0),paidRep=state.sales.filter(x=>x.repasseStatus==="Pago").reduce((s,x)=>s+Number(x.repasse||0),0),cashIn=state.cash.filter(x=>x.type==="entrada").reduce((s,x)=>s+Number(x.value||0),0),cashOut=state.cash.filter(x=>x.type==="saida").reduce((s,x)=>s+Number(x.value||0),0),cashBalance=salesTotal+cashIn-cashOut-paidRep;$("#dashboardCards").innerHTML=[["Itens em estoque",totalStock],["Valor do estoque",money(stockValue)],["Vendas brutas",money(salesTotal)],["Resultado da loja",money(storeResult)],["Repasses pendentes",money(pending)],["Saldo estimado",money(cashBalance)]].map(([a,b])=>`<div class="card"><span>${a}</span><strong>${b}</strong></div>`).join("");const recent=[...state.sales].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);$("#recentSales").innerHTML=recent.length?recent.map(s=>`<div class="list-item"><div class="list-main"><strong>${esc(s.productName)}</strong><div class="meta">${new Date(s.date).toLocaleString("pt-BR")} • ${esc(s.sku)} • ${s.qty} un.</div></div><div class="price">${money(s.total)}</div></div>`).join(""):`<div class="empty">Nenhuma venda registrada ainda.</div>`}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}