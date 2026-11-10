import douyin from '../api/douyin-cloudflare workers/workers.js';
const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
}
function equal(a, b) { if (a.length !== b.length) return false; let difference = 0; for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i); return difference === 0; }
const platforms = ['douyin.com','iesdouyin.com','kuaishou.com','xiaohongshu.com','xhslink.com','bilibili.com','b23.tv','weibo.com','weibo.cn','toutiao.com','pipix.com','ippzone.com','izuiyou.com'];
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim());
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (origin && !allowed.includes(origin)) return new Response(JSON.stringify({msg:'来源未授权'}), {status:403,headers});
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers});
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    const path = new URL(request.url).pathname;
    if (path === '/api/health') return reply({status:'ok',auth:'required',parser:true,platforms:env.PHP_BACKEND ? 'all' : ['douyin']});
    if (!env.DB) return reply({msg:'账号数据库尚未配置'},503);
    try {
      const now = Math.floor(Date.now()/1000);
      async function rate(scope, max) {
        const key = scope + ':' + await digest(request.headers.get('CF-Connecting-IP') || 'local') + ':' + Math.floor(now/600);
        const row = await env.DB.prepare('INSERT INTO limits(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,now+600).first();
        return row.count <= max;
      }
      if (Math.random() < .02) await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(now), env.DB.prepare('DELETE FROM limits WHERE expires<?').bind(now)]);
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
        const email = String(body.email || '').trim().toLowerCase(); const password = String(body.password || '');
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
      if (path==='/api/me') return reply({email:user.email});
      if (path==='/api/logout' && request.method==='POST') {await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(tokenHash).run();return reply({msg:'已退出登录'});}
      if (path!=='/api/parse') return reply({msg:'接口不存在'},404);
      if (request.method!=='POST') return reply({msg:'请使用 POST'},405);
      if (!await rate('parse',60)) return reply({msg:'操作太频繁，请稍后再试'},429);
      const match=String(body.url || '').match(/https?:\/\/[^\s<>"']+/i); if(!match) return reply({msg:'请粘贴包含链接的分享文案'},400);
      let url;try {url=new URL(match[0].replace(/[，。；,.;]+$/u,''));}catch{return reply({msg:'链接地址无效'},400);}
      if (url.username||url.password||url.port||!platforms.some(d=>url.hostname===d||url.hostname.endsWith('.'+d))) return reply({msg:'暂不支持该链接平台'},400);
      if (['douyin.com','iesdouyin.com'].some(d=>url.hostname===d||url.hostname.endsWith('.'+d))) {
        const result=await douyin.fetch(new Request('https://parser.internal/?url='+encodeURIComponent(url.href)));
        return new Response(result.body,{status:result.status,headers});
      }
      // Optional private PHP bridge enables remaining platforms. Never relay a user's session token.
      if (env.PHP_BACKEND && env.PHP_BRIDGE_SECRET) {
        const upstream=await fetch(env.PHP_BACKEND.replace(/\/$/,'')+'/api/bridge',{method:'POST',headers:{'Content-Type':'application/json','X-Bridge-Secret':env.PHP_BRIDGE_SECRET},body:JSON.stringify({url:url.href}),signal:AbortSignal.timeout(55000)});
        return new Response(upstream.body,{status:upstream.status,headers});
      }
      return reply({msg:'云端当前支持抖音。该平台需要部署 PHP 解析后端；本地完整版可用。'},501);
    } catch (error) { console.error('API error',error.message);return reply({msg:'服务暂时不可用，请稍后再试'},500); }
  }
};
