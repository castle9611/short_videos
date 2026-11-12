import assert from 'node:assert/strict';
import {parse,shareUrl} from '../android/device-parser.mjs';
assert.equal(shareUrl('复制 https://example.com/ 其他文字 https://v.douyin.com/share/。'),'https://v.douyin.com/share/');
assert.equal(shareUrl('https://user:pass@www.kuaishou.com/video'),null);
assert.equal(shareUrl('https://api.amemv.com/aweme/v1/detail/'),null);
const id='7680135425197236389',video='https://v3-dy-o.zjcdn.com/local-video.mp4';
const calls=[];
const douyin=async(url,options={})=>{
  calls.push(String(url));assert.ok(!String(url).includes('workers.dev'));
  if(String(url).includes('api.amemv.com'))return Response.json({status_code:0,aweme_detail:{aweme_id:id,desc:'抖音本地视频',author:{nickname:'作者'},video:{duration:7770,play_addr:{uri:'video-id',url_list:[video]},cover:{url_list:['https://p3.douyinpic.com/cover.jpg']}}}});
  if(String(url).includes('aweme.snssdk.com'))return new Response(null,{status:302,headers:{Location:video}});
  return new Response(null,{headers:{'Content-Type':'video/mp4','Content-Length':'1000'}});
};
let result=await parse('https://www.douyin.com/video/'+id,douyin);
assert.equal(result.code,200);assert.equal(result.data.type,'video');assert.ok(result.data.downloads.some(file=>file.kind==='video'&&file.url.startsWith(video)));assert.equal(result.data.duration,7.77);
assert.equal(result.data.quality,'original');
const high='https://v3-dy-o.zjcdn.com/1080.mp4';
for(const unavailable of [()=>new Response(null,{status:503}),()=>{throw new Error('Offline');}]){
  const fallback=await parse('https://www.douyin.com/video/'+id,async(url)=>{
    if(String(url).includes('api.amemv.com'))return Response.json({status_code:0,aweme_detail:{aweme_id:id,video:{play_addr:{uri:'video-id'},bit_rate:[
      {bit_rate:9000000,play_addr:{width:540,height:960,url_list:[video]}},
      {bit_rate:2000000,play_addr:{width:1080,height:1920,url_list:[high]}}
    ]}}});
    return unavailable();
  });
  assert.equal(fallback.code,200);assert.ok(fallback.data.url.startsWith(high));assert.equal(fallback.data.quality,'1080×1920');
}
const ks='<script>window.INIT_STATE='+JSON.stringify({tusjoh1:{photo:{caption:'手机快手图集',ext_params:{atlas:{list:['a.jpg','b.jpg']}}}}})+'</script>';
result=await parse('https://www.kuaishou.com/f/share',async(url,options)=>options.method==='HEAD'?new Response(null):new Response(ks));
assert.equal(result.code,200);assert.equal(result.data.downloads.filter(file=>file.kind==='image').length,2);
const note={type:'normal',title:'手机小红书图集',imageList:[{urlDefault:'https://sns-img.xhscdn.com/a.jpg'}]};
const xhs='<script>window.__INITIAL_STATE__='+JSON.stringify({note:{noteDetailMap:{abc:{note}}}})+'</script>';
result=await parse('https://www.xiaohongshu.com/explore/abc?xsec_token=keep',async(url)=>{assert.ok(String(url).includes('xsec_token=keep'));return new Response(xhs);});
assert.equal(result.code,200);assert.equal(result.data.downloads[0].kind,'image');
assert.equal((await parse('http://127.0.0.1/private',()=>{throw new Error('Must not fetch');})).code,400);
assert.equal((await parse('https://evil.test/',()=>{throw new Error('Must not fetch');})).code,400);
const controller=new AbortController();controller.abort();await assert.rejects(()=>parse('https://www.kuaishou.com/f/share',douyin,controller.signal),{name:'AbortError'});
console.log('PASS: bundled Douyin/Kuaishou/XHS parsers, authenticated-server independence, signed links, media registration and cancellation');
