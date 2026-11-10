const vm=require('node:vm');const fs=require('node:fs');const assert=require('node:assert/strict');
let mode='ok',chunks=[],aborted=0,finished=0,controller;
const context=vm.createContext({window:{},Blob,Uint8Array,Date,Math,Promise,Map,Error,String,btoa:value=>Buffer.from(value,'binary').toString('base64')});
context.window.ShiyingAndroid={
  beginSave(id,name,mime,size){assert.ok(name);assert.ok(size>=0);queueMicrotask(()=>{if(mode==='cancel')context.window.ShiyingDownloads.onError(id,'已取消保存');else context.window.ShiyingDownloads.onReady(id);});return '';},
  appendSave(id,base64){if(mode==='error')return '空间不足';chunks.push(Buffer.from(base64,'base64'));if(mode==='abort')controller.abort();return '';},
  finishSave(){finished++;return '';},abortSave(){aborted++;}
};
vm.runInContext(fs.readFileSync('android/native-downloads.js','utf8'),context);
(async()=>{
  const bytes=Buffer.alloc(350123);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  await context.window.ShiyingDownloads.save(new Blob([bytes],{type:'application/zip'}),'中文素材.zip');assert.equal(chunks.length,3);assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal(finished,1);
  mode='cancel';await assert.rejects(()=>context.window.ShiyingDownloads.save(new Blob(['test']),'test.txt'),/已取消保存/);
  mode='error';await assert.rejects(()=>context.window.ShiyingDownloads.save(new Blob(['test']),'test.txt'),/空间不足/);
  mode='abort';controller=new AbortController();await assert.rejects(()=>context.window.ShiyingDownloads.save(new Blob([bytes]),'test.zip',controller.signal),/已取消保存/);assert.ok(aborted>=3);assert.equal(finished,1);
  const assets='android/app/build/generated/webAssets/web';const names=fs.readdirSync(assets).sort();assert.deepEqual(names,['app.js','config.js','index.html','native-downloads.js','style.css','zip.js']);
  const config=fs.readFileSync(assets+'/config.js','utf8');assert.ok(config.includes('https://shiying-api.castle9611-shiying.workers.dev'));assert.ok(config.includes('persistSession'));
  console.log('PASS: native download chunk integrity, save cancellation/errors, abort handling and frontend-only assets');
})().catch(e=>{console.error(e);process.exitCode=1;});
