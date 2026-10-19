const {JSDOM}=require('jsdom'),fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 const dom=new JSDOM('<div id="cloudStatus"></div>',{runScripts:'outside-only'}),w=dom.window,calls=[];
 const rows=Array.from({length:1205},(_,id)=>({id:String(id)}));let fail=false;
 w.tudoTalSupabase={from(table){let start=0,end=999;const q={select(){return q},order(){return q},range(a,b){start=a;end=b;return q},then(resolve,reject){calls.push({table,start,end});return Promise.resolve(fail&&start>0?{error:Error('connection lost')}:{data:rows.slice(start,end+1),error:null}).then(resolve,reject)}};return q;}};
 vm.runInContext(fs.readFileSync('cloud-sync.js','utf8'),dom.getInternalVMContext());
 for(const method of ['fetchReceivables','fetchVipPayments']){
  const result=await w.tudoTalCloud[method]();assert.equal(result.length,1205,method+' lost rows');assert.equal(new Set(result.map(r=>r.id)).size,1205);
  fail=true;await assert.rejects(w.tudoTalCloud[method](),/connection lost/);fail=false;
 }
 dom.window.close();console.log('PASS: complete receivables/payment history over server row limit; failed page never returns a partial total.');
})().catch(e=>{console.error(e);process.exitCode=1});
