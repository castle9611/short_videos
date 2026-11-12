const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const dom=new JSDOM(fs.readFileSync('web/index.html','utf8'),{url:'https://appassets.androidplatform.net/assets/web/index.html',runScripts:'outside-only'}),w=dom.window;
Object.assign(w,{TextEncoder,AbortController,AbortSignal,Blob,Request,Response,Headers,DOMException,matchMedia:()=>({matches:true})});
Object.defineProperty(w.crypto,'randomUUID',{value:require('node:crypto').randomUUID});
w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
w.APP_CONFIG={persistSession:true};w.localStorage.setItem('shiying-token','cloud-token');let pages=0;
w.fetch=()=>{throw new Error('Built-in parsing must not use WebView fetch or a backend');};
const html='<script>window.INIT_STATE={"tusjoh1":{"photo":{"caption":"本地视频","mainMvUrls":[{"url":"https://v.a.yximgs.com/video.mp4"}]}}}</script>';
w.ShiyingAndroid={serverUrl:()=> 'device',folderName:()=> '素材',apiRequest(){throw new Error('Must not contact a backend');},platformRequest(id,url,method,headers){pages++;assert.ok(url.startsWith('https://www.kuaishou.com/'));assert.equal(JSON.parse(headers).authorization,undefined);queueMicrotask(()=>w.ShiyingDownloads.onResponse(id,JSON.stringify({status:200,body:method==='HEAD'?'':html,headers:{'Content-Type':'text/html'},url})));return '';},cancelRequest(){}};
w.eval(fs.readFileSync('android/app/build/generated/webAssets/web/device-parser.js','utf8'));
w.eval(fs.readFileSync('android/native-downloads.js','utf8'));w.eval(fs.readFileSync('web/app.js','utf8'));
(async()=>{
  await new Promise(resolve=>setImmediate(resolve));assert.equal(w.APP_CONFIG.deviceMode,true);assert.match(w.document.getElementById('account').textContent,/无需登录/);assert.equal(w.document.querySelector('#account button'),null);
  w.document.getElementById('share').value='https://www.kuaishou.com/f/test';await w.document.getElementById('parse-form').onsubmit({preventDefault(){}});
  assert.equal(pages,2);assert.equal(w.document.querySelectorAll('.media-card[data-kind="video"]').length,1);assert.equal(w.document.getElementById('auth-dialog').open,false);assert.equal(w.localStorage.getItem('shiying-token'),'cloud-token');
  console.log('PASS: actual APK parser bundle, native page transport, login-free device mode and no backend requests');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>w.close());
