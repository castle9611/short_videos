// Native equivalent of the repository's DouyinHomeParser; cookie stays in this request.
export async function parseHome(body,serverCookie='') {
  if(typeof body.url!=='string')return {status:400,msg:'请输入完整的抖音主页链接'};
  const match=body.url.match(/https:\/\/(?:www\.)?douyin\.com\/user\/([a-zA-Z0-9_.-]+)/);
  if(!match)return {status:400,msg:'请输入完整的抖音主页链接 https://www.douyin.com/user/...'};
  const cookie=body.cookie||serverCookie;
  if(typeof cookie!=='string'||cookie.length>12000||/[\r\n]/.test(cookie))return {status:400,msg:'Cookie 格式无效'};
  if(!cookie)return {status:400,msg:'主页接口需要有效的抖音 Cookie，请在主页解析设置中填写'};
  const count=body.count??18;if(!Number.isInteger(count)||count<1||count>54)return {status:400,msg:'每次获取数量须为 1–54'};
  const items=[];let cursor=0,more=true;
  for(let page=0;page<3&&more&&items.length<count;page++){
    const query=new URLSearchParams({device_platform:'webapp',aid:'6383',channel:'channel_pc_web',sec_user_id:match[1],max_cursor:String(cursor),count:String(Math.min(18,count-items.length)),publish_video_strategy_type:'2',pc_client_type:'1',version_code:'170400',version_name:'17.4.0',cookie_enabled:'true',screen_width:'1920',screen_height:'1080',browser_language:'zh-CN',browser_platform:'Win32',browser_name:'Chrome',browser_version:'120.0.0.0',browser_online:'true',engine_name:'Blink',engine_version:'120.0.0.0',os_name:'Windows',os_version:'10',cpu_core_num:'16',device_memory:'8',platform:'PC',downlink:'10',effective_type:'4g',round_trip_time:'50',webid:'verify_'+crypto.randomUUID().replaceAll('-','').slice(0,16)});
    const response=await fetch('https://www.douyin.com/aweme/v1/web/aweme/post/?'+query,{redirect:'error',headers:{Cookie:cookie,Referer:'https://www.douyin.com/user/'+match[1],'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',Accept:'application/json'},signal:AbortSignal.timeout(25000)});
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data||data.status_code||!Array.isArray(data.aweme_list))return {status:502,msg:'主页获取失败，请检查 Cookie 是否有效、作品是否公开，或稍后重试'};
    items.push(...data.aweme_list);more=Boolean(data.has_more);if(data.max_cursor===cursor)break;cursor=data.max_cursor||0;
  }
  const seen=new Set();const data=items.filter(a=>{if(!a.aweme_id||seen.has(a.aweme_id))return false;seen.add(a.aweme_id);return true;}).slice(0,count).map(a=>{
    const images=(a.images||[]).map(i=>i.url_list?.[0]).filter(Boolean);const video=a.video||{};let url=images.length?null:video.play_addr?.url_list?.[0];
    if(url&&!url.includes('mime_type='))url+=(url.includes('?')?'&':'?')+'mime_type=video_mp4';
    return {aweme_id:String(a.aweme_id),title:a.desc||'未命名作品',type:images.length?'image':'video',author:{name:a.author?.nickname||''},cover:images[0]||video.cover?.url_list?.[0]||'',url,images,duration:video.duration?video.duration/1000:null,live_photo:(a.images||[]).filter(i=>i.video?.play_addr?.url_list?.[0]).map(i=>({image:i.url_list?.[0],video:i.video.play_addr.url_list[0]})),music:{title:a.music?.title||'',url:a.music?.play_url?.url_list?.[0]||''},share_url:'https://www.douyin.com/video/'+a.aweme_id};
  });
  return {status:200,code:200,msg:'主页获取成功',data,pagination:{total:data.length,has_more:more}};
}
