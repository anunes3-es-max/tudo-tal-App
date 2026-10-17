"use strict";
// Small, dependency-free A4 PDF writer. Text uses the standard WinAnsi fonts.
(function(root){
  const cash=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const date=v=>String(v||'').split('-').reverse().join('/');
  const time=v=>new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const normalize=v=>String(v??'').replace(/[\r\n\t]+/g,' ').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim();
  function hex(v){const special={'€':128,'‚':130,'ƒ':131,'„':132,'…':133,'†':134,'‡':135,'ˆ':136,'‰':137,'Š':138,'‹':139,'Œ':140,'‘':145,'’':146,'“':147,'”':148,'•':149,'˜':152,'™':153,'š':154,'›':155,'œ':156,'Ÿ':159};return [...normalize(v)].map(c=>(special[c]??(c.charCodeAt(0)<256?c.charCodeAt(0):63)).toString(16).padStart(2,'0')).join('');}
  function width(text,size){return [...normalize(text)].reduce((n,c)=>n+(/[ilI.,:;!|' ]/.test(c)?.28:/[MW@%]/.test(c)?.9:/[A-ZÁÉÍÓÚÃÕÇ0-9]/.test(c)?.65:.54)*size,0);}
  function wrap(value,max,size){let out=[],line='';for(const word of normalize(value).split(' ')){if(width((line?line+' ':'')+word,size)<=max)line+=(line?' ':'')+word;else{if(line)out.push(line);line='';let chunk='';for(const ch of word){if(width(chunk+ch,size)>max){out.push(chunk);chunk='';}chunk+=ch;}line=chunk;}}if(line)out.push(line);return out.length?out:[''];}
  function build(report,closure){
    let pages=[],page='',y=0;
    const text=(v,x,top,size=10,bold=false,color='0.14 0.12 0.19')=>{page+=`${color} rg BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${x} ${842-top} Tm <${hex(v)}> Tj ET\n`;};
    const line=(x1,top,x2)=>{page+=`0.86 0.84 0.9 RG 0.5 w ${x1} ${842-top} m ${x2} ${842-top} l S\n`;};
    const footer=()=>{line(40,805,555);text('Tudo & Tal • controle gerencial • horário de Brasília',40,820,8,false,'0.4 0.36 0.46');text('Página '+(pages.length+1),502,820,8);};
    function newPage(){if(page){footer();pages.push(page);}page='';text('TUDO & TAL',40,48,22,true,'0.34 0.15 0.46');text(closure?'FECHAMENTO DE CAIXA':'RELATÓRIO FINANCEIRO',40,70,11,true);text(date(report.from)+' a '+date(report.to),40,89,10);text(closure?'Versão '+closure.revision+' • fechado em '+time(closure.closed_at):'Emitido em '+time(report.generated_at),40,105,9);line(40,119,555);y=141;}
    function space(h){if(y+h>780)newPage();}
    function paragraph(v,bold=false,size=10){const lines=wrap(v,515,size);for(const row of lines){space(size+6);text(row,40,y,size,bold);y+=size+6;}y+=4;}
    function title(v){space(100);y+=9;text(v,40,y,13,true,'0.34 0.15 0.46');y+=23;}
    function table(head,rows,widths){
      const header=()=>{space(30);let x=40;head.forEach((h,i)=>{text(h,x+5,y,8.5,true);x+=widths[i];});y+=11;line(40,y,555);y+=14;};header();
      if(!rows.length){paragraph('Nenhum registro neste período.',false,9);return;}
      for(const row of rows){
        const cells=row.map((v,i)=>wrap(v,widths[i]-10,8.5)),n=Math.max(...cells.map(x=>x.length));
        if(y+Math.min(n*12+14,570)>780){newPage();header();}
        let offset=0;
        while(offset<n){
          const count=Math.min(n-offset,Math.floor((780-y-14)/12));
          if(count<1){newPage();header();continue;}
          let x=40;cells.forEach((lines,i)=>{lines.slice(offset,offset+count).forEach((v,j)=>text(v,x+5,y+j*12,8.5));x+=widths[i];});
          offset+=count;y+=count*12+14;line(40,y-11,555);
          if(offset<n){newPage();header();}
        }
      }
      y+=8;
    }
    newPage();
    paragraph(closure?'Conferência salva. Este arquivo usa os valores preservados no fechamento.':'Consulta dos movimentos registrados. Este relatório não encerra o caixa.',false,9);
    title('Resumo do período');
    table(['Indicador','Valor'],[
      ['Vendas e ajustes de venda no período',cash(report.sold)],['Saldo financeiro anterior ao período',cash(report.opening)],['Entradas registradas',cash(report.inflow)],['Saídas registradas',cash(report.outflow)],['Saldo financeiro até o fim do período',cash(report.balance)],['Dinheiro físico esperado na gaveta',cash(report.cash_balance)]
    ],[365,150]);
    paragraph('O saldo considera os lançamentos registrados e o saldo inicial informado. Venda a prazo não representa dinheiro já recebido. Pix e cartão não compõem o dinheiro físico.',false,9);
    if(Number(report.unknown_balance)!==0)paragraph('Forma não identificada/Outros: '+cash(report.unknown_balance)+'. Conferir a classificação dos movimentos antigos.',false,9);
    if(closure){title('Conferência do dinheiro');table(['Indicador','Valor'],[['Esperado',cash(report.cash_balance)],['Contado',cash(closure.counted_cash)],['Diferença',cash(closure.difference)]],[365,150]);paragraph('Responsável: '+(closure.actor||closure.created_by||'Administrador'),false,9);paragraph('Observação: '+(closure.note||'Sem observações'),false,9);if(closure.reopened_at)paragraph('Reaberto em '+time(closure.reopened_at)+': '+closure.reopen_reason,true,9);}
    title('Movimentos por forma');table(['Forma','Entradas','Saídas','Variação'],(report.methods||[]).map(m=>[m.method,cash(m.inflow),cash(m.outflow),cash(m.net)]),[185,110,110,110]);
    title('Vendas, devoluções e correções');
    table(['Data / ação','Produto / motivo','Variação'],(report.events||[]).map(e=>[time(e.occurred_at)+' • '+e.action,((e.after_data?.sale||e.after_data)?.product_name||(e.before_data?.sale||e.before_data)?.product_name||e.sale_id||'')+' • '+e.reason,cash(e.sales_delta)]),[140,270,105]);
    title('Todas as entradas e saídas');
    table(['Data / categoria','Descrição / forma','Valor'],(report.movements||[]).map(m=>[time(m.occurred_at)+' • '+m.category,m.description+' • '+m.method+(m.metadata?.record_only?' • correção de registro':''),cash(m.amount)]),[140,270,105]);
    title('Pendências na emissão / no fechamento');
    paragraph('Crediário a receber: '+cash(report.vip_pending)+' • repasses a pagar: '+cash(report.owner_pending),true,10);
    paragraph('As pendências abaixo representam a posição capturada no relatório, inclusive operações de outros períodos.',false,9);
    table(['Pendência','Cliente / produto','Valor'],(report.pending||[]).map(p=>[p.description,p.customer_name||p.product_name||p.sale_id,cash(Math.abs(p.amount))+(p.kind==='card'?' (bruto)':'')]),[190,220,105]);
    if(report.closures?.length){title('Fechamentos diários no período');table(['Dia / versão','Conferência','Situação'],report.closures.map(x=>[date(x.day)+' • v'+x.revision,'Contado '+cash(x.counted_cash)+' • diferença '+cash(x.difference),x.reopened_at?'Reaberto':'Fechado']),[130,265,120]);}
    paragraph('Taxas de cartão só movimentam o caixa quando o recebimento líquido é confirmado. Os ajustes de registro são identificados no histórico. Transferências e estornos na instituição financeira são feitos fora do aplicativo.',false,9);
    footer();pages.push(page);
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
    const kids=[];for(const content of pages){const pn=objects.length+1,cn=pn+1;kids.push(pn+' 0 R');objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cn} 0 R >>`);objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);}
    objects[1]=`<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`;
    let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(pdf);
  }
  root.TudoTalFinancePdf={build,wrap};
  root.downloadFinancePdf=function(report,closure){const blob=new Blob([build(report,closure)],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='TudoTal_'+(closure?'Fechamento':'Relatorio')+'_'+report.from+'_'+report.to+(closure?'_v'+closure.revision:'')+'.pdf';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);};
  if(typeof module!=='undefined')module.exports={build,wrap};
})(typeof window!=='undefined'?window:globalThis);
