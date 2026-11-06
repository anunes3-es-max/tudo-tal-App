const vm=require('node:vm'),{JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'outside-only',url:'https://example.test/'}),w=dom.window;w.scrollTo=()=>{};const run=code=>vm.runInContext(code,dom.getInternalVMContext());
 for(const f of ['product-groups.js','app-1.js','app-2.js'])run(fs.readFileSync(f,'utf8'));
 const products=Array.from({length:120},(_,i)=>({id:'p'+i,sku:'SKU'+i,name:'Produto '+i,category:i%2?'Perfumes':'Vestuário & Brechó',catalogSection:i%2?'loja':'vestuario',qty:i<35?0:1,price:10,owner:'Loja',active:i!==119,condition:'Novo'}));
 w.fixture=products;run('state.products=fixture;state.view="dashboard";stockFilters.group="perfumes";');
 w.document.querySelector('#productSearch').value='Produto 11';w.renderProducts();assert(w.document.querySelectorAll('#productList .list-item').length<120);
 let calls=0;w.tudoTalCloud={syncAll:async()=>{calls++;return true;}};w.loadState=async()=>{run('state.products=fixture;');};
 w.nav('produtos');await w.refreshStockList();assert.equal(calls,1);assert.equal(w.document.querySelectorAll('#productList .list-item').length,120);assert.equal(w.document.querySelectorAll('#productList .badge.zero').length,35);assert(w.document.querySelector('#stockFilterSummary').textContent.includes('120 de 120'));
 w.selectStockGroup('perfumes');assert.equal(w.document.querySelectorAll('#productList .list-item').length,60);w.document.querySelector('#productSearch').value='Produto 11';w.renderProducts();w.selectStockGroup('all');assert.equal(w.document.querySelectorAll('#productList .list-item').length,120);assert.equal(w.document.querySelector('#productSearch').value,'');
 w.selectStockGroup('perfumes');run('state.view="produto-form";');w.nav('produtos');await w.refreshStockList();assert.equal(w.document.querySelectorAll('#productList .list-item').length,60,'Return from edit must preserve filter');
 w.tudoTalCloud.syncAll=async()=>false;w.nav('produtos');await w.refreshStockList();assert.equal(w.document.querySelectorAll('#productList .list-item').length,120);assert(w.document.querySelector('#stockSyncStatus').textContent.includes('última lista'));assert.equal(w.document.querySelector('#refreshStockList').disabled,false);
 dom.window.close();console.log('PASS: 120 editable records, 35 zero-stock items, opening resets filters/search, Todos clears search, return from edit keeps context, refresh is deduplicated and failed sync preserves list with warning.');
})().catch(e=>{console.error(e);process.exitCode=1});
