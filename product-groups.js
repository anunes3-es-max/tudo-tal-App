"use strict";
// Shared display taxonomy. Legacy categories remain readable without changing stock or SKUs.
(function(root){
  const groups=[
    {id:"cosmeticos",label:"Skincare e Cosméticos",sku:"COS",section:"loja"},
    {id:"perfumes",label:"Perfumes",sku:"PER",section:"loja"},
    {id:"cabelo",label:"Cabelo",sku:"CAB",section:"loja"},
    {id:"achadinhos",label:"Achadinhos",sku:"ACH",section:"loja"},
    {id:"vestuario",label:"Vestuário & Brechó",sku:"VES",section:"vestuario"}
  ];
  const normalize=value=>String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase().replace(/\s+/g," ");
  const isDonation=p=>p.is_donation===true||p.isDonation===true;
  function groupId(p){
    const category=normalize(p.category);
    if(isDonation(p)||(p.catalog_section||p.catalogSection)==="vestuario"||
      ["vestuario & brecho","vestuario e brecho","moda adulto","moda infantil","bolsas","calcados"].includes(category))return "vestuario";
    if(["skincare e cosmeticos","skincare & cosmeticos","skincare","beleza","cosmeticos","cuidado pessoal"].includes(category))return "cosmeticos";
    if(category==="perfumes")return "perfumes";
    if(category==="cabelo")return "cabelo";
    return "achadinhos";
  }
  const group=p=>groups.find(g=>g.id===groupId(p));
  const conditionOptions=[
    {id:"novo",label:"Novos",value:"Novo"},
    {id:"como_novo",label:"Usados como novos",value:"Usado como novo"},
    {id:"usado",label:"Usados",value:"Usado"}
  ];
  function conditionId(p){
    const value=normalize(p.condition);
    if(["novo","nova","novos","novas"].includes(value))return "novo";
    if(["usado como novo","usada como nova","usados como novos","usadas como novas","excelente"].includes(value))return "como_novo";
    if(["usado","usada","usados","usadas","muito bom","bom","regular"].includes(value))return "usado";
    return "";
  }
  const conditionValue=p=>conditionOptions.find(c=>c.id===conditionId(p))?.value||"";
  const sizeKey=value=>String(value||"").trim().toLocaleUpperCase("pt-BR");
  function matchesClothing(p,filters){
    return (!filters.age||(p.age_group||p.ageGroup)===filters.age)&&
      (!filters.gender||p.gender===filters.gender)&&
      (!filters.size||sizeKey(p.size)===filters.size)&&
      (!filters.condition||conditionId(p)===filters.condition)&&
      (!filters.offer||filters.offer==="all"||isDonation(p)===(filters.offer==="donation"));
  }
  root.TudoTalGroups={groups,normalize,isDonation,groupId,group,conditionOptions,conditionId,conditionValue,sizeKey,matchesClothing};
})(window);

