const vm=require('node:vm');const fs=require('node:fs');const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<section id="parser"></section><p id="status"></p><p id="download-label"></p>');
let mode='ok',chunks=[],aborted=0,finished=0,controller;
let folderName='尚未设置，保存时选择位置',batchEnds=0;
const context=vm.createContext({window:{},document:dom.window.document,Blob,Response,DOMException,Uint8Array,Date,Math,Promise,Map,Error,String,btoa:value=>Buffer.from(value,'binary').toString('base64')});
context.window.ShiyingAndroid={
  folderName(){return folderName;},
  chooseFolder(id){if(mode==='busy')return '下载进行中';queueMicrotask(()=>{if(mode==='cancel')context.window.ShiyingDownloads.onError(id,'已取消保存');else{folderName='拾影素材';context.window.ShiyingDownloads.onReady(id);}});return '';},
  beginBatch(id){queueMicrotask(()=>mode==='cancel'?context.window.ShiyingDownloads.onError(id,'已取消保存'):context.window.ShiyingDownloads.onReady(id));return '';},endBatch(){batchEnds++;},
  beginSave(id,name,mime,size){assert.ok(name);assert.ok(size>=0);queueMicrotask(()=>{if(mode==='cancel')context.window.ShiyingDownloads.onError(id,'已取消保存');else context.window.ShiyingDownloads.onReady(id);});return '';},
  downloadBatch(id,items,zip,token){assert.equal(JSON.parse(items).length,1);assert.equal(zip,true);assert.equal(token,'a'.repeat(64));queueMicrotask(()=>{if(mode==='native-abort')controller.abort();else if(mode==='error')context.window.ShiyingDownloads.onError(id,'下载失败');else{context.window.ShiyingDownloads.onProgress(id,'已处理 1 / 1 个文件');context.window.ShiyingDownloads.onReady(id,'已保存 1 个文件');}});return '';},
  cancelDownload(){aborted++;},
  apiRequest(id,path,body,token){assert.equal(path,'health');assert.equal(body,null);assert.equal(token,'');queueMicrotask(()=>{if(mode==='api-abort')controller.abort();else context.window.ShiyingDownloads.onResponse(id,JSON.stringify({status:200,body:'{"status":"ok"}'}));});return '';},
  cancelRequest(){aborted++;},
  appendSave(id,base64){if(mode==='error')return '空间不足';chunks.push(Buffer.from(base64,'base64'));if(mode==='abort')controller.abort();return '';},
  finishSave(){finished++;return '';},abortSave(){aborted++;}
};
vm.runInContext(fs.readFileSync('android/native-downloads.js','utf8'),context);
(async()=>{
  const choose=dom.window.document.querySelector('#parser button');
  assert.match(dom.window.document.querySelector('#parser').textContent,/尚未设置/);
  await choose.onclick();assert.match(dom.window.document.querySelector('#parser').textContent,/拾影素材/);assert.equal(batchEnds,1);
  mode='cancel';await choose.onclick();assert.equal(folderName,'拾影素材');assert.equal(choose.disabled,false);assert.equal(batchEnds,1);
  mode='busy';await choose.onclick();assert.equal(batchEnds,1);assert.match(dom.window.document.getElementById('status').textContent,/下载进行中/);
  mode='ok';
  assert.equal((await (await context.window.ShiyingDownloads.request('health',undefined,'',new AbortController().signal)).json()).status,'ok');
  mode='api-abort';controller=new AbortController();await assert.rejects(()=>context.window.ShiyingDownloads.request('health',undefined,'',controller.signal),{name:'AbortError'});mode='ok';
  const items=[{id:'1'.repeat(32),name:'video.mp4',url:'https://v.a.yximgs.com/video.mp4'}];
  assert.equal(await context.window.ShiyingDownloads.download(items,true,'a'.repeat(64)),'已保存 1 个文件');
  assert.equal(dom.window.document.getElementById('download-label').textContent,'已处理 1 / 1 个文件');
  mode='error';await assert.rejects(()=>context.window.ShiyingDownloads.download(items,true,'a'.repeat(64)),/下载失败/);
  mode='native-abort';controller=new AbortController();await assert.rejects(()=>context.window.ShiyingDownloads.download(items,true,'a'.repeat(64),controller.signal),/已取消保存/);
  mode='ok';
  const bytes=Buffer.alloc(350123);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  await context.window.ShiyingDownloads.save(new Blob([bytes],{type:'application/zip'}),'中文素材.zip');assert.equal(chunks.length,3);assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal(finished,1);
  await context.window.ShiyingDownloads.beginBatch();context.window.ShiyingDownloads.endBatch();
  mode='cancel';await assert.rejects(()=>context.window.ShiyingDownloads.save(new Blob(['test']),'test.txt'),/已取消保存/);
  await assert.rejects(()=>context.window.ShiyingDownloads.beginBatch(),/已取消保存/);
  mode='error';await assert.rejects(()=>context.window.ShiyingDownloads.save(new Blob(['test']),'test.txt'),/空间不足/);
  mode='abort';controller=new AbortController();await assert.rejects(()=>context.window.ShiyingDownloads.save(new Blob([bytes]),'test.zip',controller.signal),/已取消保存/);assert.ok(aborted>=3);assert.equal(finished,1);
  const assets='android/app/build/generated/webAssets/web';const names=fs.readdirSync(assets).sort();assert.deepEqual(names,['app.js','config.js','device-parser.js','index.html','media-hosts.json','mobile.css','native-downloads.js','native-ui.js','parser-hosts.json','style.css','zip.js']);
  assert.equal(fs.readFileSync(assets+'/media-hosts.json','utf8'),fs.readFileSync('config/media-hosts.json','utf8'));
  const config=fs.readFileSync(assets+'/config.js','utf8');assert.ok(config.includes('https://shiying-api.castle9611-shiying.workers.dev'));assert.ok(config.includes('persistSession'));
  console.log('PASS: download folder settings, selection cancellation/busy handling, chunk integrity, save errors, abort handling and frontend-only assets');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>dom.window.close());
