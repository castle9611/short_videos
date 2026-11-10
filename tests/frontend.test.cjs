const {JSDOM}=require('jsdom');const fs=require('node:fs');const assert=require('node:assert/strict');
const dom=new JSDOM(fs.readFileSync('web/index.html','utf8'),{url:'http://127.0.0.1:8080',runScripts:'outside-only'});const w=dom.window;
Object.assign(w,{TextEncoder,Blob,AbortController,AbortSignal,matchMedia:()=>({matches:true})});w.HTMLElement.prototype.scrollIntoView=()=>{};
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
let saved=[],lateParse,resolveLate;w.URL.createObjectURL=blob=>{saved.push(blob);return 'blob:test';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=()=>{};
w.sessionStorage.setItem('shiying-token','test-session');
const assets=Array.from({length:8},(_,i)=>({id:String(i+1).padStart(32,'0'),kind:'image',name:`图集_${i+1}.jpg`,url:`https://p3.douyinpic.com/${i}.jpg`}));
const media={title:'<img src=x onerror=alert(1)>',type:'image',images:assets.map(a=>a.url),downloads:assets,author:{name:'作者'}};
w.fetch=async(url,options)=>{
  const endpoint=url.split('/api/')[1];if(endpoint==='parse'&&lateParse)return await new Promise(resolve=>resolveLate=resolve);
  const payload=endpoint==='health'?{parser:true,platforms:'all'}:endpoint==='me'?{email:'qa@example.com'}:endpoint==='parse'?{code:200,data:media}:endpoint==='home'?{code:200,data:[media,{...media,title:'第二个作品'}]}:endpoint==='platform/douyin/status'?{state:'connected'}:{};
  return endpoint==='download'?new Response('sample-image',{headers:{'Content-Type':'image/jpeg'}}):new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}});
};
const evaluate=filename=>w.eval(fs.readFileSync(filename,'utf8'));evaluate('web/zip.js');evaluate('web/app.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));const event={preventDefault(){}};
(async()=>{
  await tick();await w.document.getElementById('parse-form').onsubmit(event);
  assert.equal(w.document.querySelectorAll('.media-card').length,8);assert.equal(w.document.querySelector('.work-heading h3').textContent,media.title);assert.equal(w.document.querySelector('.work-heading h3 img'),null);
  assert.equal(w.document.querySelectorAll('input[data-file-id]:checked').length,8);
  w.document.getElementById('select-none').click();assert.equal(w.document.getElementById('download-selected').disabled,true);
  w.document.getElementById('select-all').click();await w.document.getElementById('download-selected').onclick();assert.equal(saved.length,1);assert.equal(saved[0].type,'application/zip');
  w.document.getElementById('tab-home').click();assert.equal(w.document.getElementById('home-form').hidden,false);assert.equal(w.document.getElementById('home-cookie'),null);
  await w.document.getElementById('home-form').onsubmit(event);assert.equal(w.document.querySelectorAll('.home-works>.work-card').length,2);
  assert.equal(w.document.querySelectorAll('input[data-work]').length,2);assert.equal(w.document.querySelectorAll('.work-details').length,2);
  assert.equal(w.eval("safeUrl('javascript:alert(1)')"),null);assert.equal(w.eval("safeUrl('https://user:pass@example.com/')"),null);
  lateParse=true;const pending=w.document.getElementById('parse-form').onsubmit(event);await tick();await w.document.querySelector('#account button').onclick();
  resolveLate(new Response(JSON.stringify({code:200,data:media})));await pending;assert.equal(w.document.getElementById('result').hidden,true);assert.equal(w.document.querySelectorAll('.media-card').length,0);assert.equal(w.sessionStorage.getItem('shiying-token'),null);
  console.log('PASS: grouped results, selection, ZIP download, homepage controls, text safety and logout during parsing');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>w.close());
