const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const dom=new JSDOM(fs.readFileSync('web/index.html','utf8'),{url:'https://appassets.androidplatform.net/assets/web/index.html',runScripts:'outside-only'}),w=dom.window;
Object.assign(w,{TextEncoder,AbortController,AbortSignal,Blob,Response,DOMException});
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
const server='http://192.168.21.3:8080',calls=[];
w.APP_CONFIG={persistSession:true};w.localStorage.setItem('shiying-token','cloud-token');w.localStorage.setItem('shiying-token:'+server,'lan-token');
w.fetch=()=>{throw new Error('LAN JSON requests must use the native transport');};
w.ShiyingAndroid={serverUrl:()=>server,folderName:()=>'素材',setServer:()=> '下载进行中，请稍后切换',apiRequest(id,path,body,token){calls.push({path,body,token});queueMicrotask(()=>w.ShiyingDownloads.onResponse(id,JSON.stringify({status:200,body:JSON.stringify(path==='me'?{email:'local@example.com'}:{status:'ok'})})));return '';},cancelRequest(){}};
w.eval(fs.readFileSync('android/native-downloads.js','utf8'));w.eval(fs.readFileSync('web/app.js','utf8'));
(async()=>{
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(w.APP_CONFIG.apiBase,server);assert.equal(w.APP_CONFIG.sessionKey,'shiying-token:'+server);
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.token==='lan-token'));assert.match(w.document.getElementById('account').textContent,/local@example.com/);
  assert.equal(w.localStorage.getItem('shiying-token'),'cloud-token');
  const field=w.document.querySelector('input[aria-label="解析服务地址"]');assert.equal(field.value,server);
  const button=[...w.document.querySelectorAll('button')].find(button=>button.textContent==='切换服务');button.click();assert.match(w.document.getElementById('status').textContent,/下载进行中/);
  console.log('PASS: native LAN JSON transport, per-backend session isolation and service settings error handling');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>w.close());
