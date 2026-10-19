const {JSDOM}=require('jsdom'),{IDBFactory}=require('fake-indexeddb');
const fs=require('node:fs'),assert=require('node:assert/strict');
async function scenario(kind){
 const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://qa.invalid',runScripts:'outside-only'}),w=dom.window;
 w.indexedDB=new IDBFactory();
 if(kind!=='fresh')await new Promise((resolve,reject)=>{const q=w.indexedDB.open('TudoTalDB',1);q.onupgradeneeded=()=>{if(['existing','preserve'].includes(kind)){for(const [name,keyPath] of [['products','id'],['sales','id'],['cash','id'],['settings','key']])q.result.createObjectStore(name,{keyPath});q.transaction.objectStore('products').put({id:'old-account',qty:1});}};q.onsuccess=()=>{q.result.close();resolve();};q.onerror=()=>reject(q.error);});
 for(const file of ['app-1.js','access-control.js'])require('node:vm').runInContext(fs.readFileSync(file,'utf8'),dom.getInternalVMContext());
 if(kind!=='preserve')await w.tdtAccess.clearPrivateCache();await w.openDb();await w.loadState();
 assert.equal((await w.dbAll('products')).length,kind==='preserve'?1:0);
 for(const name of ['products','sales','cash','settings'])assert(Array.isArray(await w.dbAll(name)));
 await w.localPut('products',{id:'current-account',qty:2});await w.openDb();
 assert.equal((await w.dbAll('products')).find(p=>p.id==='current-account').qty,2);
 dom.window.close();console.log('PASS',kind);
}
(async()=>{for(const s of ['fresh','empty-v1','existing','preserve'])await scenario(s);})().catch(e=>{console.error(e);process.exitCode=1;});
