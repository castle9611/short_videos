import {createParser} from '../api/douyin-cloudflare workers/workers.js';
import {parsePlatform} from '../cloudflare/platforms.mjs';
import {formatMedia,mediaAllowed} from '../cloudflare/media.mjs';
import hosts from '../config/parser-hosts.json' with {type:'json'};

export function shareUrl(text){
  if(typeof text!=='string')return null;
  for(const match of text.slice(0,12000).matchAll(/https?:\/\/[^\s<>"']+/gi)){
    try{const url=new URL(match[0].replace(/[，。；,.;）)\]】]+$/u,''));if(!url.username&&!url.password&&!url.port&&hosts.filter(host=>!['amemv.com','snssdk.com'].includes(host)).some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))return url.href;}catch{}
  }
  return null;
}

export async function parse(text,fetcher,signal){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>12000)return {code:400,msg:'请粘贴有效的分享链接',data:[]};
  const shared=shareUrl(text);if(!shared)return {code:400,msg:'请粘贴抖音、快手或小红书的分享链接',data:[]};
  const url=new URL(shared);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||!hosts.some(d=>url.hostname===d||url.hostname.endsWith('.'+d)))return {code:400,msg:'暂不支持该链接平台',data:[]};
  url.protocol='https:';
  const network=(address,options={})=>{
    if(signal?.aborted)throw new DOMException('解析已取消','AbortError');
    const target=new URL(String(address));
    // Size is optional; resolving a media redirect must not download its body.
    if(mediaAllowed(target.href)&&!hosts.some(host=>target.hostname===host||target.hostname.endsWith('.'+host)))return Promise.resolve(new Response(null,{headers:{'Content-Type':'video/mp4','Content-Length':'0'}}));
    const controller=new AbortController();const abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});options.signal?.addEventListener('abort',abort,{once:true});
    if(options.signal?.aborted)controller.abort();
    return fetcher(address,{...options,signal:controller.signal}).finally(()=>{signal?.removeEventListener('abort',abort);options.signal?.removeEventListener('abort',abort);});
  };
  let result;
  if(['douyin.com','iesdouyin.com'].some(d=>url.hostname===d||url.hostname.endsWith('.'+d))){
    const response=await createParser(network).fetch(new Request('https://parser.internal/?url='+encodeURIComponent(url.href)));result=await response.json();
  }else if(['kuaishou.com','gifshow.com','chenzhongtech.com'].some(d=>url.hostname===d||url.hostname.endsWith('.'+d)))result=await parsePlatform(url.href,'kuaishou',network);
  else if(['xiaohongshu.com','rednote.com','xhslink.com','xhslink.cn','xhs.com'].some(d=>url.hostname===d||url.hostname.endsWith('.'+d)))result=await parsePlatform(url.href,'xiaohongshu',network);
  else return {code:400,msg:'请使用抖音、快手或小红书的分享链接',data:[]};
  if(signal?.aborted)throw new DOMException('解析已取消','AbortError');
  if(result.code===200){result.data=formatMedia(result.data);if(!result.data.downloads.some(file=>['video','image','live'].includes(file.kind)))return {code:404,msg:'未获取到可下载的视频或图片，请重新复制完整分享链接',data:[]};}
  return result;
}
