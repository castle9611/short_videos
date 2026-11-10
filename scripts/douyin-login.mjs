import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

// Application functionality: the user performs official Douyin login in an isolated window.
// Never inspect the user's existing browser profile or automate credential entry/CAPTCHAs.
export function createLoginHelper({secret,profileRoot,browserType=chromium}){
  if(!secret||secret.length<32)throw new Error('PLATFORM_HELPER_SECRET is required');
  const sessions=new Map();
  const validSecret=value=>{const a=Buffer.from(value||''),b=Buffer.from(secret);return a.length===b.length&&timingSafeEqual(a,b);};
  async function readSession(session){
    if(session?.context){try{const cookies=(await session.context.cookies()).filter(c=>c.domain==='douyin.com'||c.domain.endsWith('.douyin.com'));const login=cookies.find(c=>['sessionid','sessionid_ss'].includes(c.name)&&c.value);if(login){session.cookie=cookies.map(c=>c.name+'='+c.value).join('; ');session.expires=login.expires>0?Math.min(Date.now()+8*3600000,login.expires*1000):Date.now()+8*3600000;}}catch{/* Window closed by user; retain only the last captured session in memory. */}}
    if(session?.expires<Date.now())session.cookie='';return session?.cookie||'';
  }
  const server=http.createServer(async(req,res)=>{
    const reply=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    if(req.headers.origin||req.method!=='POST'||!validSecret(req.headers['x-helper-secret']))return reply({msg:'Forbidden'},403);
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024){reply({msg:'Too large'},413);return;}}
    let body;try{body=JSON.parse(raw||'{}');}catch{return reply({msg:'Invalid JSON'},400);}
    if(req.url==='/health')return reply({available:true});
    if(req.url==='/shutdown'){reply({ok:true});await shutdown();return;}
    const id=body.userId;if(!Number.isSafeInteger(id)||id<1)return reply({msg:'Invalid user'},400);
    let session=sessions.get(id);
    if(req.url==='/start'){
      if(session?.opening)return reply({state:'opening'});
      if(session?.context){const page=session.context.pages()[0];if(page)await page.bringToFront().catch(()=>{});return reply({state:await readSession(session)?'connected':'waiting'});}
      if([...sessions.values()].filter(s=>s.context||s.opening).length>=4)return reply({msg:'同时登录窗口过多，请先关闭其他窗口'},429);
      session={opening:true,cookie:'',expires:0};sessions.set(id,session);
      (async()=>{try{
        const profile=path.join(profileRoot,String(id));await mkdir(profile,{recursive:true});
        session.context=await browserType.launchPersistentContext(profile,{channel:process.env.DOUYIN_BROWSER_CHANNEL||'msedge',headless:false,viewport:null,chromiumSandbox:true,acceptDownloads:false});
        session.context.on('close',()=>{session.context=null;});
        const page=session.context.pages()[0]||await session.context.newPage();await page.goto('https://www.douyin.com/',{waitUntil:'domcontentloaded',timeout:45000});
        session.opening=false;
      }catch{session.error='无法打开抖音登录窗口，请确认已安装 Microsoft Edge；关闭冲突的登录窗口后重试';session.opening=false;session.context=null;}})();
      return reply({state:'opening'});
    }
    if(req.url==='/disconnect'){if(session?.context){await session.context.clearCookies();await session.context.close();}sessions.delete(id);return reply({state:'disconnected'});}
    if(!['/status','/cookie'].includes(req.url))return reply({msg:'Not found'},404);
    const cookie=await readSession(session);
    if(req.url==='/cookie')return reply({cookie});
    return reply({available:true,state:cookie?'connected':session?.error?'error':session?.opening?'opening':session?.context?'waiting':'disconnected',msg:session?.error||''});
  });
  async function shutdown(){for(const session of sessions.values())await session.context?.close().catch(()=>{});sessions.clear();server.close();}
  return {server,shutdown};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const helper=createLoginHelper({secret:process.env.PLATFORM_HELPER_SECRET,profileRoot:path.resolve(process.env.APP_DATA_DIR||'var','douyin-profiles')});
  helper.server.listen(Number(process.env.PLATFORM_HELPER_PORT||9310),'127.0.0.1',()=>console.log('Douyin login helper ready on loopback'));
  process.on('SIGTERM',()=>helper.shutdown());process.on('SIGINT',()=>helper.shutdown());
}
