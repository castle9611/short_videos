import douyin from '../api/douyin-cloudflare workers/workers.js';
import {registerMedia,downloadMedia} from './media.mjs';
import {parseHome} from './home.mjs';
import {parsePlatform} from './platforms.mjs';
const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
}
function equal(a, b) { if (a.length !== b.length) return false; let difference = 0; for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i); return difference === 0; }
const platforms = ['douyin.com','iesdouyin.com','kuaishou.com','gifshow.com','chenzhongtech.com','xiaohongshu.com','xhslink.com','xhslink.cn','xhs.com'];
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim());
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (origin && origin !== new URL(request.url).origin && !allowed.includes(origin)) return new Response(JSON.stringify({msg:'来源未授权'}), {status:403,headers});
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers});
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) {
      if (!['GET','HEAD'].includes(request.method)) return reply({msg:'请使用 GET'},405);
      if (!['/','/index.html','/style.css','/app.js','/config.js','/zip.js','/downloads/shiying.apk'].includes(path) || !env.ASSETS) return reply({msg:'页面不存在'},404);
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body,asset);
      response.headers.set('Cache-Control','no-cache');
      response.headers.set('X-Content-Type-Options','nosniff');
      response.headers.set('Referrer-Policy','no-referrer');
      if(path==='/downloads/shiying.apk'&&response.ok){response.headers.set('Content-Type','application/vnd.android.package-archive');response.headers.set('Content-Disposition','attachment; filename="Shiying-1.0.2.apk"');}
      response.headers.set('Content-Security-Policy',"default-src 'self'; img-src 'self' https: http: data:; media-src https: http:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      return response;
    }
    if (path === '/api/health') return reply({status:'ok',auth:'required',parser:!!env.DB,platforms:['douyin','kuaishou','xiaohongshu'],platformWarnings:{xiaohongshu:'小红书部分作品在云端被要求平台登录，可能无法解析；本地版可用'},features:{home:env.ENABLE_HOME==='1'}});
    if (!['GET','POST'].includes(request.method)) return reply({msg:'请求方法不支持'},405);
    if (!env.DB) return reply({msg:'账号数据库尚未配置'},503);
    try {
      const now = Math.floor(Date.now()/1000);
      async function rate(scope, max) {
        const key = scope + ':' + await digest(request.headers.get('CF-Connecting-IP') || 'local') + ':' + Math.floor(now/600);
        const row = await env.DB.prepare('INSERT INTO limits(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,now+600).first();
        return row.count <= max;
      }
      if (Math.random() < .02) await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(now), env.DB.prepare('DELETE FROM limits WHERE expires<?').bind(now),env.DB.prepare('DELETE FROM assets WHERE expires<?').bind(now)]);
      let body = {};
      if (request.method === 'POST') {
        if (Number(request.headers.get('Content-Length') || 0)>16384) return reply({msg:'请求内容过长'},413);
        const reader = request.body?.getReader(); const chunks=[]; let length=0;
        if (reader) while (true) { const {done,value}=await reader.read(); if (done) break; length+=value.length; if(length>16384){await reader.cancel();return reply({msg:'请求内容过长'},413);} chunks.push(value); }
        const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
        try {body=JSON.parse(new TextDecoder().decode(bytes));} catch {return reply({msg:'无效的 JSON 请求'},400);}
        if (!body || Array.isArray(body) || typeof body !== 'object') return reply({msg:'无效的 JSON 请求'},400);
      }
      if (['/api/register','/api/login'].includes(path)) {
        if (request.method!=='POST') return reply({msg:'请使用 POST'},405);
        if (!await rate('auth',20)) return reply({msg:'操作太频繁，请稍后再试'},429);
        if (typeof body.email!=='string'||typeof body.password!=='string') return reply({msg:'邮箱和密码必须为字符串'},400);
        const email = body.email.trim().toLowerCase(); const password = body.password;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||encoder.encode(password).length<10||encoder.encode(password).length>72) return reply({msg:'请输入有效邮箱，密码需为 10–72 字节'},400);
        let user=await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
        if (path==='/api/register') {
          if (user) return reply({msg:'该邮箱已注册，请登录'},409);
          const salt=random();const passwordHash=await hashPassword(password,salt);
          try {await env.DB.prepare('INSERT INTO users(email,password,salt) VALUES (?,?,?)').bind(email,passwordHash,salt).run();}
          catch(e) {if(String(e).includes('UNIQUE')) return reply({msg:'该邮箱已注册，请登录'},409);throw e;}
          user=await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
        } else {
          const computed=await hashPassword(password,user?.salt || 'dummy-salt-for-login-timing');
          if (!user||!equal(computed,user.password)) return reply({msg:'邮箱或密码错误'},401);
        }
        const token=random();await env.DB.prepare('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)').bind(await digest(token),user.id,now+86400).run();
        return reply({token,email,expiresIn:86400});
      }
      const token=(request.headers.get('Authorization') || '').replace(/^Bearer /,'');
      const tokenHash=await digest(token);
      const user=await env.DB.prepare('SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?').bind(tokenHash,now).first();
      if (!user) return reply({msg:'请先注册或登录'},401);
      if (path==='/api/me') return request.method==='GET' ? reply({email:user.email}) : reply({msg:'请使用 GET'},405);
      if (path==='/api/logout' && request.method==='POST') {await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(tokenHash).run();return reply({msg:'已退出登录'});}
      if(path==='/api/platform/douyin/status')return reply({available:false,state:'unavailable',msg:'抖音登录窗口当前由本地版提供，云端登录待接入'});
      if(['/api/platform/douyin/login','/api/platform/douyin/disconnect'].includes(path))return reply({msg:'请先使用本地版登录抖音；云端登录待接入'},501);
      if(path==='/api/download'){
        if(request.method!=='POST')return reply({msg:'请使用 POST'},405);
        if(!await rate('download',120))return reply({msg:'下载过于频繁，请稍后重试'},429);
        return await downloadMedia(env.DB,user.id,body,headers);
      }
      if(path==='/api/home'){
        if(env.ENABLE_HOME!=='1')return reply({msg:'主页批量功能暂未开放'},404);
        if(request.method!=='POST')return reply({msg:'请使用 POST'},405);
        if(!await rate('home',10))return reply({msg:'主页请求过于频繁，请稍后重试'},429);
        const result=await parseHome(body,env.DOUYIN_COOKIE||'');
        if(result.status!==200)return reply({code:result.status,msg:result.msg,data:[]},result.status);
        const data=[];for(const item of result.data)data.push(await registerMedia(env.DB,user.id,item));
        return reply({...result,data});
      }
      if (path!=='/api/parse') return reply({msg:'接口不存在'},404);
      if (request.method!=='POST') return reply({msg:'请使用 POST'},405);
      if (!await rate('parse',60)) return reply({msg:'操作太频繁，请稍后再试'},429);
      if (typeof body.url!=='string'||encoder.encode(body.url).length>12000) return reply({msg:'分享文案必须为字符串，且不能超过 12000 字节'},400);
      const match=body.url.match(/https?:\/\/[^\s<>"']+/i); if(!match) return reply({msg:'请粘贴包含链接的分享文案'},400);
      let url;try {url=new URL(match[0].replace(/[，。；,.;]+$/u,''));}catch{return reply({msg:'链接地址无效'},400);}
      if (url.username||url.password||url.port||!platforms.some(d=>url.hostname===d||url.hostname.endsWith('.'+d))) return reply({msg:'暂不支持该链接平台'},400);
      if (['douyin.com','iesdouyin.com'].some(d=>url.hostname===d||url.hostname.endsWith('.'+d))) {
        const result=await douyin.fetch(new Request('https://parser.internal/?url='+encodeURIComponent(url.href)));
        const parsed=await result.json();if(parsed.code===200&&parsed.data)parsed.data=await registerMedia(env.DB,user.id,parsed.data);
        return reply(parsed,result.status);
      }
      const platform=['kuaishou.com','gifshow.com','chenzhongtech.com'].some(d=>url.hostname===d||url.hostname.endsWith('.'+d))?'kuaishou':'xiaohongshu';
      const parsed=await parsePlatform(url.href,platform);if(parsed.code===200)parsed.data=await registerMedia(env.DB,user.id,parsed.data);return reply(parsed,parsed.code>=500?502:200);
    } catch (error) { console.error('API error',error.message);return reply({msg:'服务暂时不可用，请稍后再试'},500); }
  }
};
