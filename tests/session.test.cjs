const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const dom=new JSDOM(fs.readFileSync('web/index.html','utf8'),{url:'http://localhost',runScripts:'outside-only'});
const w=dom.window;
Object.assign(w,{TextEncoder,AbortController,AbortSignal,Blob});
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
w.HTMLDialogElement.prototype.close=function(){this.open=false;};
w.fetch=async()=>new Response('{}');
w.eval(fs.readFileSync('web/app.js','utf8')+'\nwindow.testLogin=value=>{sessionVersion++;token=value;sessionStore.setItem("shiying-token",token);};');
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const login=token=>w.testLogin(token);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  await tick();
  for(const status of [200,401]){
    login('old-session');
    let resolve;
    w.fetch=()=>new Promise(done=>resolve=done);
    const pending=w.eval("api('me')");
    const rejected=assert.rejects(pending,{name:'AbortError'});
    login('new-session');
    resolve(json({email:'old@example.com',msg:'expired'},status));
    await rejected;
    assert.equal(w.sessionStorage.getItem('shiying-token'),'new-session');
    assert.equal(w.document.getElementById('auth-dialog').open,false);
  }
  // Switching accounts while the response body is being decoded is also stale.
  let resolveBody;
  w.fetch=async()=>({status:200,ok:true,json:()=>new Promise(done=>resolveBody=done)});
  const pending=w.eval("api('me')");
  const rejected=assert.rejects(pending,{name:'AbortError'});
  await tick();login('latest-session');resolveBody({email:'old@example.com'});await rejected;
  let finishDownload;
  w.fetch=async()=>({status:200,ok:true,headers:new Headers(),body:{getReader:()=>({read:()=>new Promise(done=>finishDownload=done)})}});
  const download=w.eval("api('download',{id:'test'},undefined,true)");
  const downloadRejected=assert.rejects(download,{name:'AbortError'});
  await tick();login('download-session');finishDownload({done:true});await downloadRejected;
  let resolveHealth;
  w.fetch=()=>new Promise(done=>resolveHealth=done);
  const health=w.eval("api('health')");login('health-session');resolveHealth(json({status:'ok'}));
  assert.equal((await health).status,'ok');
  // A 401 for the current session still logs out and opens the login dialog.
  w.fetch=async()=>json({msg:'请先注册或登录'},401);
  await assert.rejects(w.eval("api('me')"),/请先注册或登录/);
  assert.equal(w.sessionStorage.getItem('shiying-token'),null);
  assert.equal(w.document.getElementById('auth-dialog').open,true);
  console.log('PASS: stale responses cannot replace or revoke a newer session; current 401 still logs out');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>w.close());
