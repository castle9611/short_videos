import suffixes from '../config/media-hosts.json';
export function mediaAllowed(value) {
  try { const u=new URL(value); return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port&&suffixes.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)); } catch {return false;}
}
export async function registerMedia(db,userId,input) {
  const d={...input,title:input.title||input.desc||input.description||'未命名作品'};
  d.author=typeof input.author==='string'?{name:input.author}:input.author||input.user||{};
  d.images=Array.isArray(input.images)?input.images:[];
  d.type=input.type||(d.images.length?'image':'video');
  d.music=input.music||{url:input.music_url||'',title:input.music_title||''};
  if(typeof d.music==='string')d.music={url:d.music};
  if(d.type==='image'&&!d.images.length&&d.url)d.images=[d.url];
  if(d.type==='image')d.url=null;
  const base=d.title.replace(/[\x00-\x1f\\/:*?"<>|]/g,'_').slice(0,40)||'拾影';
  const group=crypto.randomUUID().slice(0,8),seen=new Set(),rows=[],statements=[];
  const add=(url,kind,index=1)=>{
    if(typeof url!=='string'||!mediaAllowed(url)||seen.has(url)||rows.length>=100)return;
    seen.add(url); const id=crypto.randomUUID().replaceAll('-','');
    const ext=new URL(url).pathname.match(/\.(jpg|jpeg|png|webp|avif|gif|mp4|m4a|mp3|webm)$/i)?.[1]||(['video','live'].includes(kind)?'mp4':kind==='music'?'mp3':'jpg');
    const name=`${base}_${group}_${kind}_${String(index).padStart(2,'0')}.${ext}`;
    statements.push(db.prepare('INSERT INTO assets(id,user_id,url,name,kind,expires) VALUES (?,?,?,?,?,?)').bind(id,userId,url,name,kind,Math.floor(Date.now()/1000)+3600));rows.push({id,name,kind,url});
  };
  add(d.url,'video');d.images.forEach((u,i)=>add(u,'image',i+1));
  (d.live_photo||[]).forEach((v,i)=>{add(v.image,'image',i+1);add(v.video,'live',i+1);});
  (d.videos||[]).forEach((v,i)=>add(v.url,'video',i+1));add(d.cover,'cover');add(d.music.url,'music');
  if(statements.length)await db.batch(statements);d.downloads=rows;return d;
}
export async function downloadMedia(db,userId,body,headers) {
  const fail=(msg,status)=>new Response(JSON.stringify({msg}),{status,headers});
  if(typeof body.id!=='string'||!/^[a-f0-9]{32}$/.test(body.id))return fail('无效的下载编号',400);
  const asset=await db.prepare('SELECT * FROM assets WHERE id=? AND user_id=? AND expires>?').bind(body.id,userId,Math.floor(Date.now()/1000)).first();
  if(!asset)return fail('下载链接已过期或无权访问，请重新解析',404);
  let url=asset.url;
  for(let i=0;i<6;i++){
    if(!mediaAllowed(url))return fail('媒体地址不在允许的下载域名内',400);
    const host=new URL(url).hostname;
    const referer=host.includes('bili')?'https://www.bilibili.com/':/sina|weibo/.test(host)?'https://weibo.com/':/xhs|xiaohongshu/.test(host)?'https://www.xiaohongshu.com/':/kwimg|yximg|kwaicdn/.test(host)?'https://www.kuaishou.com/':'https://www.douyin.com/';
    const response=await fetch(url,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0','Referer':referer},signal:AbortSignal.timeout(90000)});
    if(response.status>=300&&response.status<400&&response.headers.get('Location')){url=new URL(response.headers.get('Location'),url).href;await response.body?.cancel();continue;}
    if(!response.ok||!response.body)return fail('媒体服务器拒绝下载，请重新解析后重试',502);
    const type=response.headers.get('Content-Type')||'application/octet-stream';
    if(!/^(image\/|video\/|audio\/|application\/octet-stream)/i.test(type))return fail('媒体服务器未返回有效媒体文件',502);
    const limit=100*1024*1024;if(Number(response.headers.get('Content-Length'))>limit)return fail('单个文件超过 100 MB 下载上限',413);
    let size=0;const stream=response.body.pipeThrough(new TransformStream({transform(chunk,controller){size+=chunk.byteLength;if(size>limit){controller.error(new Error('Download size limit exceeded'));return;}controller.enqueue(chunk);}}));
    return new Response(stream,{headers:{...headers,'Content-Type':type,'Content-Disposition':`attachment; filename="shiying-download"; filename*=UTF-8''${encodeURIComponent(asset.name)}`}});
  }
  return fail('媒体重定向次数过多',502);
}
