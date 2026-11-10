import {renderXhs} from './xhs-browser.mjs';
const desktop='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const mobile='Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1 Edg/122.0.0.0';
const android='Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36';
const domains={kuaishou:['kuaishou.com','gifshow.com','chenzhongtech.com'],xiaohongshu:['xiaohongshu.com','rednote.com','xhslink.com','xhslink.cn','xhs.com']};
function allowed(url,platform){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port&&domains[platform].some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}catch{return false;}}
async function page(input,platform,ua,fetcher){
  let url=input,canonical=input;
  for(let i=0;i<6;i++){
    if(!allowed(url,platform)){let host='';try{host=new URL(url).hostname;}catch{}throw new Error('分享链接跳转到了不支持的地址'+(host?'（'+host+'）':''));}
    if(platform==='xiaohongshu'&&/\/(?:explore|item|note)\/[a-zA-Z0-9]+/.test(new URL(url).pathname))canonical=url;
    const r=await fetcher(url,{redirect:'manual',headers:{'User-Agent':ua,Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8','Accept-Language':'zh-CN,zh;q=0.9',...(platform==='kuaishou'?{'Sec-Fetch-Dest':'document','Sec-Fetch-Mode':'navigate','Sec-Fetch-Site':'none','Sec-Fetch-User':'?1','sec-ch-ua':'"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"','sec-ch-ua-mobile':'?0','sec-ch-ua-platform':'"Windows"'}:{})},signal:AbortSignal.timeout(15000)});
    if(r.status>=300&&r.status<400&&r.headers.get('Location')){url=new URL(r.headers.get('Location'),url).href;await r.body?.cancel();continue;}
    if(!r.ok)throw new Error('平台暂时拒绝访问，请检查链接是否公开可访问');
    const reader=r.body.getReader(),chunks=[];let size=0;while(true){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>4*1024*1024){await reader.cancel();throw new Error('平台页面过大');}chunks.push(v.value);}
    return {url,canonical,html:await new Blob(chunks).text()};
  }
  throw new Error('分享链接跳转次数过多');
}
export function embeddedState(html,name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=new RegExp('(?:window\\.)?'+escaped+'\\s*=\\s*').exec(html);if(!m)return null;
  let start=m.index+m[0].length;while(/\s/.test(html[start]||'')&&start<html.length)start++;
  if(html[start]!=='{')return null;let depth=0,quote=false,escape=false;
  for(let i=start;i<html.length;i++){const c=html[i];if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quote=false;continue;}if(c==='"'){quote=true;continue;}if(c==='{')depth++;if(c==='}'&&--depth===0){try{return JSON.parse(html.slice(start,i+1).replace(/"(?:\\.|[^"\\])*"|\bundefined\b/g,t=>t==='undefined'?'null':t));}catch{return null;}}}
  return null;
}
function https(value){return typeof value==='string'?value.replace(/^http:\/\//,'https://'):'';}
function originalXhsImage(value){
  const url=https(value);let m=url.match(/\/oss-sg\/([a-zA-Z0-9_]+)\/([a-zA-Z0-9]+)!/);
  if(m&&!/^[a-f0-9]{32}$|^\d+$/.test(m[1]))return `https://sns-img-hw.xhscdn.com/oss-sg/${m[1]}/${m[2]}?imageView2/2/w/0/format/jpg`;
  m=url.match(/\/([a-zA-Z0-9_]+)\/([a-zA-Z0-9]+)!/);
  if(m&&!/^[a-f0-9]{32}$|^\d+$/.test(m[1]))return `https://sns-img-hw.xhscdn.com/${m[1]}/${m[2]}?imageView2/2/w/0/format/jpg`;
  m=url.match(/(notes_pre_post|spectrum|notes_uhdr)\/([a-zA-Z0-9]+)/);if(m)return `https://sns-img-hw.xhscdn.com/${m[1]}/${m[2]}?imageView2/2/w/0/format/jpg`;
  m=url.match(/\/([a-zA-Z0-9]+)!/);if(m)return `https://ci.xiaohongshu.com/${m[1]}?imageView2/2/w/0/format/jpg`;return url;
}
export function formatXhs(note){
  const imageUrl=img=>originalXhsImage(img.url||img.urlDefault||img.urlPre||'');
  const pictures=Array.isArray(note.imageList)?note.imageList:[];
  const streams=[...(note.video?.media?.stream?.h264||[]),...(note.video?.media?.stream?.h265||[])];
  // H.264 first for mobile/WebView playback; preserve higher-quality alternatives.
  const h264=[...(note.video?.media?.stream?.h264||[])].sort((a,b)=>(b.avgBitrate||b.videoBitrate||0)-(a.avgBitrate||a.videoBitrate||0));
  const main=h264[0]||streams[0];const url=https(main?.masterUrl||(note.video?.consumer?.originVideoKey?'https://sns-video-bd.xhscdn.com/'+note.video.consumer.originVideoKey:''));
  const live=pictures.map(i=>({image:imageUrl(i),video:https(i.stream?.h264?.[0]?.masterUrl||i.stream?.h265?.[0]?.masterUrl||'')})).filter(i=>i.video);
  const type=note.type==='video'?'video':live.length?'live':'image';
  return {type,title:note.title||note.desc||'',desc:note.desc||'',author:{name:note.user?.nickname||note.user?.nickName||'',id:String(note.user?.userId||''),avatar:https(note.user?.avatar||'')},cover:imageUrl(pictures[0]||{})||https(note.cover?.url||''),url:type==='video'?url:null,images:type==='video'?[]:pictures.map(imageUrl).filter(Boolean),live_photo:type==='video'?[]:live,video_backup:streams.map(s=>https(s.masterUrl)).filter(v=>v&&v!==url),duration:note.video?.capa?.duration||null,music:{}};
}
export function extractXhs(html,url){
  const state=embeddedState(html,'__INITIAL_STATE__');if(!state)return null;const id=url.match(/\/(?:explore|item|note)\/([a-zA-Z0-9]+)/)?.[1];
  const map=state.note?.noteDetailMap||{};const note=map[id]?.note||state.noteData?.data?.noteData;
  return note?formatXhs(note):null;
}
export function extractKuaishou(html,url){
  const state=embeddedState(html,'INIT_STATE');const entry=state&&Object.entries(state).find(([key,value])=>key.startsWith('tusjoh')&&value?.photo)?.[1];
  const photo=entry?.photo;
  if(photo){
    const atlas=photo.ext_params?.atlas;let images=(atlas?.list||[]).map(v=>https(/^https?:/.test(v)?v:'https://tx2.a.yximgs.com/'+v));
    const single=photo.photoType==='SINGLE_PICTURE'||photo.singlePicture===true;if(single&&!images.length)images=[https(photo.coverUrls?.[0]?.url)].filter(Boolean);
    const video=https(photo.mainMvUrls?.[0]?.url||photo.manifest?.adaptationSet?.[0]?.representation?.[0]?.url);
    const music=photo.music||photo.soundTrack||{};
    if(images.length||video)return {type:images.length?'image':'video',title:photo.caption||'',author:{name:photo.userName||'',avatar:https(photo.headUrl||'')},cover:images[0]||https(photo.coverUrls?.[0]?.url||''),url:images.length?null:video,images,live_photo:[],music:{title:music.name||'',url:https(music.audioUrls?.[0]?.url||'')},duration:photo.duration?photo.duration/1000:null};
  }
  const apollo=embeddedState(html,'__APOLLO_STATE__')?.defaultClient;if(!apollo)return null;
  const id=url.match(/\/(?:short-video|long-video|photo)\/([^/?]+)/)?.[1]||new URL(url).searchParams.get('photoId');
  const data=apollo['VisionVideoDetailPhoto:'+id];if(!data)return null;
  const author=Object.entries(apollo).find(([k])=>k.startsWith('VisionVideoDetailAuthor:'))?.[1]||{};
  const video=https(data.photoUrl||data.manifestH265?.json?.adaptationSet?.[0]?.representation?.[0]?.backupUrl?.[0]);
  if(!video)return null;const image=data.photoType==='SINGLE_PICTURE'||data.singlePicture===true;return {type:image?'image':'video',title:data.caption||'',author:{name:author.name||'',avatar:https(author.headerUrl||'')},cover:https(data.coverUrl||''),url:image?null:video,images:image?[video]:[],live_photo:[],music:{}};
}
async function parseHttpPlatform(url,platform,fetcher=fetch){
  try{
    let requiresLogin=false;
    if(!domains[platform]||!allowed(url,platform))return {code:400,msg:'链接平台无效',data:[]};
    if(platform==='kuaishou')for(let i=0;i<6;i++){
      if(!allowed(url,platform))throw new Error('分享链接跳转到了不支持的地址');
      const head=await fetcher(url,{method:'HEAD',redirect:'manual',headers:{'User-Agent':mobile},signal:AbortSignal.timeout(10000)});
      const next=head.headers.get('Location');await head.body?.cancel();if(head.status>=300&&head.status<400&&next){url=new URL(next,url).href;continue;}break;
    }
    for(const ua of platform==='xiaohongshu'?[desktop,android]:[mobile,desktop]){
      const result=await page(url,platform,ua,fetcher);const data=platform==='xiaohongshu'?extractXhs(result.html,result.url):extractKuaishou(result.html,result.url);
      if(platform==='xiaohongshu'&&/\/(?:login|website-login)(?:\/|$)/.test(new URL(result.url).pathname))requiresLogin=true;
      if(data&&(data.url||data.images.length||data.live_photo.length))return {code:200,msg:'解析成功',data};
      if(platform==='xiaohongshu'&&result.canonical!==url&&/\/(?:explore|item|note)\/[a-zA-Z0-9]+/.test(new URL(result.canonical).pathname)){
        const shared=new URL(result.canonical);shared.hostname='www.xiaohongshu.com';shared.searchParams.set('app_platform','android');shared.searchParams.set('ignoreEngage','true');shared.searchParams.set('xsec_source','app_share');url=shared.href;
      }
    }
    if(requiresLogin)return {code:403,msg:'小红书在当前云端网络要求登录，暂时无法读取该作品；可使用本地版解析',data:[]};
    return {code:404,msg:'未获取到公开作品，请使用完整分享链接（小红书需保留 xsec_token），或稍后重试',data:[]};
  }catch(e){return {code:502,msg:e.name==='TimeoutError'?'平台响应超时，请稍后重试':e.message,data:[]};}
}

export async function parsePlatform(url,platform,fetcher=fetch,browser=null){
  const result=await parseHttpPlatform(url,platform,fetcher);
  if(platform!=='xiaohongshu'||result.code===200||!browser||!allowed(url,platform))return result;
  try{
    const data=await renderXhs(url,browser);
    if(data)return {code:200,msg:'解析成功',data};
  }catch{ /* Keep the actionable HTTP error when browser quota or rendering fails. */ }
  return result;
}
