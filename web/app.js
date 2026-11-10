const $ = id => document.getElementById(id);
const base = window.APP_CONFIG?.apiBase?.replace(/\/$/,'') || location.origin;
let token=sessionStorage.getItem('shiying-token')||'', registering=false, busy=false, sessionVersion=0;
let parseController,downloadController;let files=[];const selected=new Set();
let platformTimer;
let previewFiles=[],previewIndex=0;
function node(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function safeUrl(value){if(typeof value!=='string')return null;try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
async function api(path,body,signal,binary=false){
  const response=await fetch(base+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:signal||AbortSignal.timeout(95000)});
  if(response.status===401&&!['login','register'].includes(path)){clearSession();showAuth();}
  if(binary&&response.ok){
    const reader=response.body.getReader(),chunks=[];let size=0;
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>100*1024*1024){await reader.cancel();throw new Error('单个文件超过 100 MB');}chunks.push(value);}
    return new Blob(chunks,{type:response.headers.get('Content-Type')||'application/octet-stream'});
  }
  const result=await response.json().catch(()=>{throw new Error('服务返回异常，请稍后重试');});
  if(!response.ok)throw new Error(result.msg||'请求失败');return result;
}
function showAuth(){if(!$('auth-dialog').open)$('auth-dialog').showModal();}
function clearSession(){sessionVersion++;clearInterval(platformTimer);platformTimer=undefined;parseController?.abort();downloadController?.abort();token='';sessionStorage.removeItem('shiying-token');files=[];selected.clear();$('works').replaceChildren();$('result').hidden=true;$('image-preview').close();$('preview-image').removeAttribute('src');previewFiles=[];$('douyin-state').textContent='抖音尚未连接';$('douyin-disconnect').hidden=true;renderAccount();}
function renderAccount(email){
  $('account').replaceChildren();if(email)$('account').append(node('span','',email));
  const button=node('button','text-button',token?'退出登录 ↗':'登录 / 注册 ↗');
  button.onclick=async()=>{if(!token)return showAuth();button.disabled=true;parseController?.abort();downloadController?.abort();try{await api('logout',{});clearSession();$('status').textContent='已退出登录';}catch(e){button.disabled=false;$('status').textContent='退出失败，请重试：'+e.message;}};
  $('account').append(button);
}
$('close-auth').onclick=()=>$('auth-dialog').close();
$('switch-auth').onclick=()=>{registering=!registering;$('auth-title').textContent=registering?'创建你的账号':'登录拾影';$('auth-submit').textContent=registering?'注册并登录 ↗':'登录 ↗';$('password').autocomplete=registering?'new-password':'current-password';$('switch-auth').textContent=registering?'已有账号？返回登录':'还没有账号？立即注册';$('auth-error').textContent='';};
$('auth-form').onsubmit=async event=>{
  event.preventDefault();$('auth-submit').disabled=true;$('auth-error').textContent='';
  try{if(new TextEncoder().encode($('password').value).length>72)throw new Error('密码不能超过 72 字节');const data=await api(registering?'register':'login',{email:$('email').value,password:$('password').value});sessionVersion++;token=data.token;sessionStorage.setItem('shiying-token',token);renderAccount(data.email);$('password').value='';$('auth-dialog').close();$('status').textContent='登录成功，可以开始解析了';}
  catch(e){$('auth-error').textContent=e.message;}finally{$('auth-submit').disabled=false;}
};
function mode(home){$('home-form').hidden=!home;$('parse-form').hidden=home;$('tab-home').setAttribute('aria-selected',String(home));$('tab-single').setAttribute('aria-selected',String(!home));$('nav-home').classList.toggle('active',home);$('nav-single').classList.toggle('active',!home);if(home&&token)platformStatus();}
async function platformStatus(){if(!token)return;const version=sessionVersion;try{const state=await api('platform/douyin/status');if(version!==sessionVersion)return;const labels={connected:'抖音已登录 · 可获取主页',opening:'正在打开独立登录窗口…',waiting:'请在抖音窗口中完成登录',disconnected:'抖音尚未连接',unavailable:state.msg,error:state.msg};$('douyin-state').textContent=labels[state.state]||state.msg||'抖音尚未连接';$('douyin-disconnect').hidden=!['connected','waiting','opening'].includes(state.state);if(['connected','error','unavailable','disconnected'].includes(state.state)){clearInterval(platformTimer);platformTimer=undefined;}}catch(e){$('douyin-state').textContent=e.message;clearInterval(platformTimer);platformTimer=undefined;}}
$('douyin-login').onclick=async()=>{if(!token)return showAuth();$('douyin-login').disabled=true;try{await api('platform/douyin/login',{});$('douyin-state').textContent='请在独立的抖音窗口中完成登录';clearInterval(platformTimer);platformTimer=setInterval(platformStatus,2500);await platformStatus();}catch(e){$('douyin-state').textContent=e.message;}finally{$('douyin-login').disabled=false;}};
$('douyin-disconnect').onclick=async()=>{try{await api('platform/douyin/disconnect',{});await platformStatus();}catch(e){$('douyin-state').textContent=e.message;}};
$('tab-home').onclick=()=>mode(true);$('tab-single').onclick=()=>mode(false);$('nav-home').onclick=()=>mode(true);$('nav-single').onclick=()=>mode(false);
async function parse(event,home){
  event.preventDefault();if(!token)return showAuth();if(busy||downloadController)return;$('status').textContent=home?'正在获取主页作品，请稍候…':'正在解析作品，请稍候…';busy=true;const version=sessionVersion;
  const button=$(home?'home-button':'parse-button');button.disabled=true;parseController=new AbortController();const controller=parseController;const timer=setTimeout(()=>controller.abort('timeout'),95000);
  const payload=home?{url:$('home-url').value,count:Number($('home-count').value)}:{url:$('share').value};
  try{const result=await api(home?'home':'parse',payload,controller.signal);if(version!==sessionVersion||!token)return;if(Number(result.code)!==200)throw new Error(result.msg||'解析失败，请检查链接');renderResults(home?result.data:[result.data],home,result.pagination);$('status').textContent=home?'主页作品已获取，可勾选批量下载':'解析完成，可选择需要保存的素材';}
  catch(e){if(version===sessionVersion)$('status').textContent=controller.signal.reason==='timeout'?'请求超时，请稍后重试':controller.signal.aborted?'解析已取消':e.message;}
  finally{clearTimeout(timer);busy=false;parseController=undefined;button.disabled=false;}
}
$('parse-form').onsubmit=e=>parse(e,false);$('home-form').onsubmit=e=>parse(e,true);
const kinds={video:'视频',image:'原图',live:'实况视频',music:'背景音乐',cover:'封面'};
function updateSelection(){
  $('result-meta').textContent=`${files.length} 个素材 · 已选择 ${selected.size} 个`;
  $('download-selected').textContent=`下载所选 ZIP (${selected.size})`;$('download-selected').disabled=!selected.size||!!downloadController;
  document.querySelectorAll('input[data-file-id]').forEach(input=>{input.checked=selected.has(input.dataset.fileId);});
  document.querySelectorAll('input[data-work]').forEach(input=>{const group=files.filter(f=>f.work===Number(input.dataset.work)&&['video','image','live'].includes(f.kind));input.checked=group.length>0&&group.every(f=>selected.has(f.id));input.indeterminate=group.some(f=>selected.has(f.id))&&!input.checked;});
}
function saveBlob(blob,name){const url=URL.createObjectURL(blob);const a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function download(items,zip){
  if(downloadController||busy)return;if(!token)return showAuth();if(!items.length||items.length>100){$('status').textContent='每次请选择 1–100 个文件';return;}
  const version=sessionVersion;downloadController=new AbortController();const controller=downloadController;const timeout=setTimeout(()=>controller.abort('timeout'),15*60000);const entries=[],failed=[];let total=0;
  $('download-progress').hidden=false;updateSelection();
  try{
    for(let i=0;i<items.length;i++){
      if(controller.signal.aborted)throw new Error('下载已取消');$('download-label').textContent=`正在下载 ${i+1} / ${items.length} · ${items[i].name}`;
      try{const blob=await api('download',{id:items[i].id},controller.signal,true);total+=blob.size;if(total>150*1024*1024)throw new Error('所选文件总大小超过 150 MB，请减少选择');entries.push({name:items[i].name,blob});}
      catch(e){if(controller.signal.aborted||!token||total>150*1024*1024)throw e;failed.push(items[i].name+'：'+e.message);}
    }
    if(version!==sessionVersion||!token)return;if(!entries.length)throw new Error(failed[0]||'没有可下载的文件');
    if(zip){if(failed.length)entries.push({name:'下载失败清单.txt',blob:new Blob([failed.join('\n')],{type:'text/plain;charset=utf-8'})});$('download-label').textContent='正在生成 ZIP…';const blob=await window.DownloadZip.create(entries);if(controller.signal.aborted||version!==sessionVersion)return;saveBlob(blob,'拾影素材_'+new Date().toISOString().slice(0,10)+'.zip');}
    else saveBlob(entries[0].blob,entries[0].name);
    $('status').textContent=`已保存 ${entries.length-(zip&&failed.length?1:0)} 个文件`+(failed.length?`；${failed.length} 个失败，详情见 ZIP 内清单`:'');
  }catch(e){if(version===sessionVersion)$('status').textContent=controller.signal.aborted?'下载已取消':e.message;}
  finally{clearTimeout(timeout);downloadController=undefined;$('download-progress').hidden=true;updateSelection();}
}
$('cancel-download').onclick=()=>downloadController?.abort();$('download-selected').onclick=()=>download(files.filter(f=>selected.has(f.id)),true);
$('select-all').onclick=()=>{files.forEach(f=>selected.add(f.id));updateSelection();};$('select-none').onclick=()=>{selected.clear();updateSelection();};
function showImage(file){previewFiles=files.filter(f=>['image','cover'].includes(f.kind));previewIndex=previewFiles.findIndex(f=>f.id===file.id);refreshImage();if(!$('image-preview').open)$('image-preview').showModal();}
function refreshImage(){const file=previewFiles[previewIndex];if(!file)return;$('preview-image').src=safeUrl(file.url);$('preview-image').alt=file.name;$('preview-count').textContent=`${previewIndex+1} / ${previewFiles.length}`;$('preview-prev').disabled=previewIndex===0;$('preview-next').disabled=previewIndex===previewFiles.length-1;}
$('preview-close').onclick=()=>$('image-preview').close();$('preview-prev').onclick=()=>{if(previewIndex>0){previewIndex--;refreshImage();}};$('preview-next').onclick=()=>{if(previewIndex<previewFiles.length-1){previewIndex++;refreshImage();}};$('preview-download').onclick=()=>download([previewFiles[previewIndex]],false);
$('image-preview').onkeydown=e=>{if(e.key==='ArrowLeft')$('preview-prev').click();if(e.key==='ArrowRight')$('preview-next').click();};
let touchX;$('preview-image').addEventListener('touchstart',e=>{touchX=e.changedTouches[0].clientX;},{passive:true});$('preview-image').addEventListener('touchend',e=>{if(touchX===undefined)return;const dx=e.changedTouches[0].clientX-touchX;if(Math.abs(dx)>45)$(dx<0?'preview-next':'preview-prev').click();touchX=undefined;},{passive:true});
function fileCard(file){
  const card=node('article','media-card');card.dataset.kind=file.kind;const top=node('div','media-preview');const src=safeUrl(file.url);
  if(['video','live'].includes(file.kind)&&src){const video=node('video');video.src=src;video.controls=true;video.preload='none';if(safeUrl(file.cover))video.poster=safeUrl(file.cover);top.append(video);}
  else if(file.kind==='music'){const audio=node('audio');audio.controls=true;audio.preload='none';audio.src=src;top.append(node('span','audio-mark','♫'),audio);}
  else if(src){const link=node('button','image-open');link.type='button';link.setAttribute('aria-label','预览 '+file.name);link.onclick=()=>showImage(file);const img=node('img');img.src=src;img.alt=file.name;img.loading='lazy';img.referrerPolicy='no-referrer';link.append(img);top.append(link);}
  const choose=node('label','file-choice');const input=node('input');input.type='checkbox';input.dataset.fileId=file.id;input.setAttribute('aria-label','选择 '+file.name);input.onchange=()=>{input.checked?selected.add(file.id):selected.delete(file.id);updateSelection();};choose.append(input,node('span','',kinds[file.kind]||'素材'));top.append(choose);card.append(top);
  const bottom=node('div','media-bottom');const name=node('span','file-name',file.name);name.title=file.name;const button=node('button','secondary','下载 ↓');button.onclick=()=>download([file],false);bottom.append(name,button);card.append(bottom);return card;
}
function renderResults(items,home,pagination){
  if(!Array.isArray(items))throw new Error('接口未返回有效作品列表');files=[];selected.clear();$('works').replaceChildren();$('result-title').textContent=home?`主页作品 · ${items.length} 条`:'作品素材';$('works').className=home?'home-works':'';
  items.forEach((item,index)=>{
    if(!item||typeof item!=='object')return;const assets=(Array.isArray(item.downloads)?item.downloads:[]).filter(f=>/^[a-f0-9]{32}$/.test(f.id)&&safeUrl(f.url)).map(f=>({...f,work:index,cover:item.cover}));files.push(...assets);assets.filter(f=>['video','image','live'].includes(f.kind)).forEach(f=>selected.add(f.id));
    const section=node('article','work-card');const heading=node('div','work-heading');const title=node('h3','',item.title||item.desc||'未命名作品');heading.append(title,node('span','type-tag',item.type==='video'?'视频':item.type==='live'?'实况':'图集'));section.append(heading);
    const meta=node('p','work-meta',[item.author?.name,item.duration?item.duration+' 秒':'',`${assets.length} 个素材`].filter(Boolean).join(' · '));section.append(meta);
    if(home){const controls=node('div','work-actions');const label=node('label','');const checkbox=node('input');checkbox.type='checkbox';checkbox.dataset.work=String(index);checkbox.onchange=()=>{assets.filter(f=>['video','image','live'].includes(f.kind)).forEach(f=>checkbox.checked?selected.add(f.id):selected.delete(f.id));updateSelection();};label.append(checkbox,document.createTextNode(' 选择作品'));const all=node('button','secondary','下载此作品');all.onclick=()=>download(assets.filter(f=>['video','image','live'].includes(f.kind)),assets.length!==1);controls.append(label,all);section.append(controls);if(safeUrl(item.cover)){const cover=node('img','work-cover');cover.src=safeUrl(item.cover);cover.alt=item.title||'作品封面';cover.loading='lazy';cover.referrerPolicy='no-referrer';section.append(cover);}}
    const grid=node('div','media-grid');assets.forEach(f=>grid.append(fileCard(f)));
    if(home){const details=node('details','work-details');details.append(node('summary','',`展开 ${assets.length} 个素材`),grid);section.append(details);}else section.append(grid);
    if(!assets.length)section.append(node('p','field-note','此作品未返回可下载素材，可能已失效或受到平台限制。'));$('works').append(section);
  });
  if(!items.length)$('works').append(node('p','empty-result','没有找到公开作品，请检查主页和 Cookie。'));
  if(home&&pagination?.has_more)$('works').append(node('p','field-note','主页还有更多作品。本次已返回所选数量，可调整获取数量后重试。'));
  $('result').hidden=false;updateSelection();$('result').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
renderAccount();api('health').then(d=>{$('connection').textContent='服务已连接 · 支持抖音 / 快手 / 小红书'+(d.platformWarnings?.xiaohongshu?'。'+d.platformWarnings.xiaohongshu:'');if(d.platformWarnings?.xiaohongshu)document.querySelector('[data-platform="xiaohongshu"]').title=d.platformWarnings.xiaohongshu;if(d.features?.home){document.querySelector('.mode-tabs').hidden=false;$('nav-home').hidden=false;}}).catch(()=>{$('connection').textContent='后端暂时无法连接，请检查服务状态';});
if(token)api('me').then(d=>renderAccount(d.email)).catch(e=>{$('status').textContent=e.message;});
