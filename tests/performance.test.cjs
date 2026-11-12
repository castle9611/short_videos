const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const dom=new JSDOM(fs.readFileSync('web/index.html','utf8'),{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
Object.assign(w,{TextEncoder,Blob,AbortController,AbortSignal,matchMedia:()=>({matches:true})});
w.HTMLElement.prototype.scrollIntoView=()=>{};
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
w.sessionStorage.setItem('shiying-token','session');
let now=1000,parses=0,active=0,maxActive=0,saved=[],fail=false,cancel=false;
w.Date.now=()=>now;
const assets=Array.from({length:8},(_,i)=>({id:String(i+1).padStart(32,'0'),name:`${i+1}.jpg`,kind:'image',url:`https://p3.douyinpic.com/${i}.jpg`}));
w.URL.createObjectURL=blob=>{saved.push(blob);return 'blob:test';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=()=>{};
w.fetch=async(url,options)=>{
  const path=url.split('/api/')[1];
  if(path==='parse'){parses++;return Response.json({code:200,data:{type:'image',title:'图集',downloads:assets}});}
  if(path==='download'){
    const id=JSON.parse(options.body).id;active++;maxActive=Math.max(active,maxActive);
    try{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,id===assets[0].id?20:2);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));},{once:true});if(cancel)queueMicrotask(()=>w.document.getElementById('cancel-download').click());});
      if(fail&&id===assets[1].id)return Response.json({msg:'下载失败'},{status:502});
      return new Response(id,{headers:{'Content-Type':'image/jpeg'}});
    }finally{active--;}
  }
  return Response.json(path==='me'?{email:'qa@example.com'}:{});
};
w.eval(fs.readFileSync('web/zip.js','utf8'));w.eval(fs.readFileSync('web/app.js','utf8'));
const tick=()=>new Promise(resolve=>setImmediate(resolve)),event={preventDefault(){}};
const parse=()=>w.document.getElementById('parse-form').onsubmit(event);
(async()=>{
  await tick();w.document.getElementById('share').value='https://v.douyin.com/gallery/';
  await parse();await parse();assert.equal(parses,1);assert.match(w.document.getElementById('status').textContent,/复用/);
  now+=120001;await parse();assert.equal(parses,2);
  await w.document.getElementById('download-individual').onclick();assert.equal(maxActive,3);assert.equal(active,0);
  assert.deepEqual(await Promise.all(saved.map(blob=>blob.text())),assets.map(a=>a.id));
  fail=true;saved=[];await w.document.getElementById('download-selected').onclick();assert.equal(saved.length,1);assert.match(w.document.getElementById('status').textContent,/1 个失败/);
  await parse();assert.equal(parses,3); // A failed asset invalidates cached CDN links.
  fail=false;cancel=true;saved=[];await w.document.getElementById('download-individual').onclick();await tick();assert.equal(active,0);assert.equal(saved.length,0);assert.equal(w.document.getElementById('download-progress').hidden,true);
  cancel=false;
  w.ShiyingDownloads={download:async(items,zip,token)=>{assert.equal(items.length,8);assert.equal(zip,false);assert.equal(token,'session');return '已保存 8 个文件';},endBatch(){}};
  await w.document.getElementById('download-individual').onclick();assert.match(w.document.getElementById('status').textContent,/已保存 8/);assert.equal(saved.length,0);
  await w.document.querySelector('#account button').onclick();
  // Simulate the next authenticated session without retaining the previous cache.
  w.document.getElementById('email').value='next@example.com';w.document.getElementById('password').value='long-password';
  const fetch=w.fetch;w.fetch=async(url,options)=>url.endsWith('/login')?Response.json({token:'next-session',email:'next@example.com'}):fetch(url,options);
  await w.document.getElementById('auth-form').onsubmit(event);await parse();assert.equal(parses,4);
  console.log('PASS: two-minute session cache, expiry/failure invalidation, three concurrent images, ordered saves, cancellation and native download delegation');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>w.close());
