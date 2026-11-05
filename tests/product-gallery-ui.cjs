const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const dom=new JSDOM('<button id="trigger">Produto</button>',{runScripts:'outside-only',url:'https://tudoetalstore.github.io/'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 let result={data:['https://example.com/front.jpg','https://example.com/back.jpg']};w.client={rpc:async(name,args)=>{assert.equal(name,'get_catalog_product_photos');assert(args.p_product_id);return result;}};
 w.eval(fs.readFileSync('../store/product-gallery.js','utf8'));
 await w.openProductGallery({id:'a',name:'Produto <teste>',photo_url:'https://example.com/old.jpg'},w.document.querySelector('#trigger'));
 const d=w.document.querySelector('dialog'),img=d.querySelector('.gallery-stage img');assert(d.open);assert.equal(d.querySelector('h2').textContent,'Produto <teste>');assert.equal(d.querySelector('teste'),null);assert.equal(img.src,result.data[0]);
 d.querySelector('[data-next]').click();assert.equal(img.src,result.data[1]);assert.equal(d.querySelector('[data-counter]').textContent,'2 de 2');d.querySelector('[data-in]').click();assert(img.style.transform.includes('scale(2)'));d.querySelector('[data-prev]').click();assert(img.style.transform.includes('scale(1)'));
 d.querySelector('[data-close]').click();assert(!d.open);assert.equal(w.document.activeElement.id,'trigger');assert(!w.document.body.classList.contains('gallery-open'));
 result={error:{message:'offline'}};await w.openProductGallery({id:'b',name:'B',photo_url:'https://example.com/cover.jpg'},w.document.querySelector('#trigger'));assert.equal(img.src,'https://example.com/cover.jpg');assert(d.querySelector('.gallery-status').textContent.includes('Não foi possível'));d.close();
 let resolve;w.client.rpc=()=>new Promise(r=>{resolve=r;});const pending=w.openProductGallery({id:'c',name:'C'},w.document.querySelector('#trigger'));d.close();resolve({data:['https://example.com/stale.jpg']});await pending;assert(!d.open);assert.equal(img.getAttribute('src'),null);
 dom.window.close();
 const edit=new JSDOM('<div id="photoPreview"></div><input id="productPhoto"><p id="photoUploadStatus"></p><button id="saveProductButton"></button>',{runScripts:'outside-only'}),e=edit.window;e.state={editPhotos:['https://example.com/a.jpg','https://example.com/b.jpg']};e.toast=()=>{};
 e.eval(fs.readFileSync('product-photos.js','utf8'));e.renderProductPhotos();e.document.querySelectorAll('.product-photo-editor')[1].querySelector('button').click();assert.equal(e.state.editPhoto,'https://example.com/b.jpg');e.document.querySelectorAll('.product-photo-editor button')[1].click();assert.equal(e.state.editPhoto,'https://example.com/a.jpg');e.document.querySelectorAll('.product-photo-editor button')[1].click();assert.equal(e.state.editPhoto,'');assert.equal(e.state.editPhotos.length,0);
 e.fileToPhoto=async f=>f.name;await e.addProductPhotos({target:{files:[{name:'https://example.com/new.jpg'}],value:'',disabled:false}});assert.equal(e.state.editPhotos.length,1);assert.equal(e.state.editPhoto,'https://example.com/new.jpg');assert.equal(e.document.querySelector('#saveProductButton').disabled,false);
 e.fileToPhoto=async()=>{throw Error('bad photo')};await e.addProductPhotos({target:{files:[{}],value:'',disabled:false}});assert.equal(e.state.editPhotos.length,1);assert.equal(e.state.photosLoading,false);
 edit.window.close();console.log('PASS: gallery navigation, zoom/reset, safe title, close/focus, load failure, stale response, editor cover/removal, upload and failure recovery');
})().catch(e=>{console.error(e);process.exitCode=1});
