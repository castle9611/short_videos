(() => {
  if (!window.ShiyingAndroid) return;
  const waiting=new Map();
  const cloud='https://shiying-api.castle9611-shiying.workers.dev';
  if(window.ShiyingAndroid.serverUrl){
    const server=window.ShiyingAndroid.serverUrl();
    window.APP_CONFIG={...window.APP_CONFIG,apiBase:server==='device'?location.origin:server,deviceMode:server==='device',sessionKey:server===cloud?'shiying-token':'shiying-token:'+server};
    const service=document.createElement('section');service.className='settings-group service-settings';
    const serviceTitle=document.createElement('h2');serviceTitle.textContent='解析方式';
    const current=document.createElement('p');current.textContent='当前：'+(server==='device'?'手机本地解析 · 无需电脑或登录':server===cloud?'云端服务':'局域网服务');
    const local=document.createElement('button');local.type='button';local.className='mode-choice';local.textContent='手机本地解析';local.setAttribute('aria-pressed',String(server==='device'));
    const label=document.createElement('label');label.textContent='可选局域网服务地址';
    const input=document.createElement('input');input.type='url';input.value=server==='device'||server===cloud?'':server;input.placeholder='http://192.168.21.3:8080';input.setAttribute('aria-label','解析服务地址');
    const apply=document.createElement('button');apply.type='button';apply.className='secondary';apply.textContent='切换服务';
    const reset=document.createElement('button');reset.type='button';reset.className='mode-choice';reset.textContent='云端解析';reset.setAttribute('aria-pressed',String(server===cloud));
    const note=document.createElement('p');note.textContent='推荐手机本地模式，直接访问平台。也可手动切换云端或电脑局域网服务；各服务账号独立。';
    const change=value=>{const error=window.ShiyingAndroid.setServer(value);if(error){document.getElementById('status').textContent=error;return;}location.reload();};
    const lan=document.createElement('details');lan.className='lan-settings';lan.open=server!=='device'&&server!==cloud;const summary=document.createElement('summary');summary.textContent='连接电脑服务';
    local.onclick=()=>change('device');apply.onclick=()=>change(input.value);reset.onclick=()=>change(cloud);label.append(input);lan.append(summary,label,apply);service.append(serviceTitle,current,local,reset,lan,note);(document.getElementById('app-service-settings')||document.getElementById('parser')).append(service);
    if(server==='device')document.querySelector('.badge').textContent='手机本地解析';
  }
  const settings=document.createElement('section');settings.className='settings-group folder-settings';
  const folderTitle=document.createElement('h2');folderTitle.textContent='下载目录';const folderNote=document.createElement('p');folderNote.textContent='选择一次，之后自动保存到这里。';
  const folder=document.createElement('span');folder.className='folder-path';
  const choose=document.createElement('button');choose.type='button';choose.className='secondary';choose.textContent='设置下载目录';
  const refresh=()=>{const name=window.ShiyingAndroid.folderName();folder.textContent=name;choose.textContent=name.includes('尚未设置')?'设置下载目录':'更换目录';};
  refresh();settings.append(folderTitle,folderNote,folder,choose);(document.getElementById('app-folder-settings')||document.getElementById('parser')).append(settings);
  function refreshHistory(){
    const host=document.getElementById('app-history');if(!host||!window.ShiyingAndroid.downloadHistory)return;
    host.replaceChildren();let entries=[];try{entries=JSON.parse(window.ShiyingAndroid.downloadHistory());}catch{}
    const summary=document.createElement('p');summary.className='field-note';summary.textContent=entries.length?entries.length+' 个已保存文件 · 点击文件可打开':'暂无下载历史。开启保留历史后，新下载的文件会出现在这里。';host.append(summary);
    if(entries.length){const actions=document.createElement('div');actions.className='history-actions';for(const [text,remove] of [['仅清空记录',false],['删除历史文件',true]]){const button=document.createElement('button');button.type='button';button.className='secondary'+(remove?' danger':'');button.textContent=text;button.onclick=()=>window.ShiyingAndroid.clearHistory(remove);actions.append(button);}host.append(actions);}
    for(const entry of entries.reverse()){
      const button=document.createElement('button');button.type='button';button.className='history-file';const name=document.createElement('strong'),meta=document.createElement('span');name.textContent=entry.name;
      meta.textContent=new Date(entry.time).toLocaleString('zh-CN',{hour12:false})+' · '+(entry.bytes<1048576?(entry.bytes/1024).toFixed(0)+' KB':(entry.bytes/1048576).toFixed(1)+' MB');button.append(name,meta);button.onclick=()=>window.ShiyingAndroid.openHistory(entry.uri);host.append(button);
    }
  }
  if(window.ShiyingAndroid.keepHistoryEnabled){
    const group=document.createElement('section');group.className='settings-group';const title=document.createElement('h2');title.textContent='下载历史';const label=document.createElement('label');label.className='clipboard-toggle';const text=document.createElement('span');text.textContent='保留下载历史';const toggle=document.createElement('input');toggle.type='checkbox';toggle.id='keep-history';toggle.setAttribute('role','switch');toggle.checked=window.ShiyingAndroid.keepHistoryEnabled();toggle.onchange=()=>window.ShiyingAndroid.setKeepHistory(toggle.checked);label.append(text,toggle);
    const note=document.createElement('p');note.textContent='文件始终保存在下载目录。关闭后不再记录新下载，已有历史仍保留。可在“历史”页清空记录或删除对应文件；升级前的文件不会自动加入。';group.append(title,label,note);document.getElementById('app-history-settings')?.append(group);
    document.addEventListener('shiying:history',refreshHistory);refreshHistory();
  }
  if(window.ShiyingAndroid.autoClipboardEnabled){
    const startup=document.createElement('section');startup.className='settings-group startup-settings';
    const title=document.createElement('h2');title.textContent='启动行为';
    const label=document.createElement('label');label.className='clipboard-toggle';const text=document.createElement('span');text.textContent='打开时识别剪贴板';
    const toggle=document.createElement('input');toggle.type='checkbox';toggle.id='auto-clipboard';toggle.setAttribute('role','switch');toggle.checked=window.ShiyingAndroid.autoClipboardEnabled();toggle.onchange=()=>window.ShiyingAndroid.setAutoClipboard(toggle.checked);
    const note=document.createElement('p');note.textContent='自动填入分享链接并解析。每次打开会清空上次输入，进行中的任务不受影响。';label.append(text,toggle);startup.append(title,label,note);(document.getElementById('app-startup-settings')||document.getElementById('parser')).append(startup);
  }
  choose.onclick=async()=>{
    if(choose.disabled)return;choose.disabled=true;
    const id='batch_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    try{await new Promise((resolve,reject)=>{waiting.set(id,{resolve,reject});const error=window.ShiyingAndroid.chooseFolder(id);if(error)reject(new Error(error));});window.ShiyingAndroid.endBatch();document.getElementById('status').textContent='下载目录已保存，以后下载将自动保存到此目录';}
    catch(error){document.getElementById('status').textContent=error.message;}
    finally{waiting.delete(id);refresh();choose.disabled=false;}
  };
  window.ShiyingDownloads={
    onAppOpen(){document.dispatchEvent(new Event('shiying:open'));},
    autoClipboardEnabled(){return window.ShiyingAndroid.autoClipboardEnabled?.()||false;},
    clipboardText(){return window.ShiyingAndroid.clipboardText?.()||'';},
    onReady(id,message){waiting.get(id)?.resolve(message);refreshHistory();},
    onHistoryChanged(id,message){refreshHistory();document.getElementById('status').textContent=message;},
    onError(id,message){waiting.get(id)?.reject(new Error(message));},
    onResponse(id,message){try{const result=JSON.parse(message);const response=new Response([204,205,304].includes(result.status)?null:result.body,{status:result.status,headers:result.headers||{'Content-Type':'application/json'}});if(result.url)Object.defineProperty(response,'url',{value:result.url});waiting.get(id)?.resolve(response);}catch(error){waiting.get(id)?.reject(error);}},
    async platformFetch(input,options={}){
      let url=String(input);const method=(options.method||'GET').toUpperCase(),signal=options.signal||AbortSignal.timeout(20000);
      const headers=JSON.stringify(Object.fromEntries(new Headers(options.headers||{})));
      for(let redirect=0;redirect<6;redirect++){
        const id='platform_'+Date.now()+'_'+Math.random().toString(36).slice(2);
        const abort=()=>{window.ShiyingAndroid.cancelRequest(id);waiting.get(id)?.reject(new DOMException('解析已取消','AbortError'));};
        const timer=setTimeout(()=>{waiting.get(id)?.reject(new Error('平台请求超时，请稍后重试'));window.ShiyingAndroid.cancelRequest(id);},20000);
        let response;
        try{if(signal.aborted)throw new DOMException('解析已取消','AbortError');signal.addEventListener('abort',abort,{once:true});response=await new Promise((resolve,reject)=>{waiting.set(id,{resolve,reject});const error=window.ShiyingAndroid.platformRequest(id,url,method,headers);if(error)reject(new Error(error));});}
        finally{clearTimeout(timer);waiting.delete(id);signal.removeEventListener('abort',abort);}
        const next=response.headers.get('Location');
        if(options.redirect==='manual'||response.status<300||response.status>=400||!next)return response;
        if(options.redirect==='error')throw new Error('平台发生跳转');url=new URL(next,url).href;
      }
      throw new Error('平台跳转次数过多');
    },
    async request(path,body,token,signal){
      if(window.APP_CONFIG?.deviceMode){
        if(path==='health')return Response.json({status:'ok',parser:true,auth:'none',features:{home:false}});
        if(path==='parse'){const result=await window.ShiyingDeviceParser.parse(body?.url,this.platformFetch,signal);return Response.json(result,{status:result.code>=500?502:200});}
        return Response.json({msg:'手机本地模式无需账号，仅支持单条作品解析'},{status:400});
      }
      const id='api_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      const abort=()=>{window.ShiyingAndroid.cancelRequest(id);waiting.get(id)?.reject(new DOMException('请求已取消','AbortError'));};
      try{if(signal.aborted)throw new DOMException('请求已取消','AbortError');signal.addEventListener('abort',abort,{once:true});return await new Promise((resolve,reject)=>{waiting.set(id,{resolve,reject});const error=window.ShiyingAndroid.apiRequest(id,path,body===undefined?null:JSON.stringify(body),token);if(error)reject(new Error(error));});}
      finally{waiting.delete(id);signal.removeEventListener('abort',abort);}
    },
    onProgress(id,message){waiting.get(id)?.progress?.(message);},
    async download(items,zip,token,signal){
      await this.beginBatch(signal);
      const id='download_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      const abort=()=>{window.ShiyingAndroid.cancelDownload(id);waiting.get(id)?.reject(new Error('已取消保存'));};
      try{
        if(signal?.aborted)throw new Error('已取消保存');signal?.addEventListener('abort',abort,{once:true});
        return await new Promise((resolve,reject)=>{waiting.set(id,{resolve,reject,progress:message=>{document.getElementById('download-label').textContent=message;}});const error=window.ShiyingAndroid.downloadBatch(id,JSON.stringify(items.map(({id,name,url})=>({id,name,url}))),zip,token);if(error)reject(new Error(error));});
      }finally{waiting.delete(id);signal?.removeEventListener('abort',abort);}
    },
    async beginBatch(signal){
      const id='batch_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      const abort=()=>{window.ShiyingAndroid.endBatch();waiting.get(id)?.reject(new Error('已取消保存'));};
      try{if(signal?.aborted)throw new Error('已取消保存');signal?.addEventListener('abort',abort,{once:true});await new Promise((resolve,reject)=>{waiting.set(id,{resolve,reject});const error=window.ShiyingAndroid.beginBatch(id);if(error)reject(new Error(error));});}
      finally{waiting.delete(id);signal?.removeEventListener('abort',abort);refresh();}
    },
    endBatch(){window.ShiyingAndroid.endBatch();},
    async save(blob,name,signal){
      const id='save_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      const aborted=()=>{window.ShiyingAndroid.abortSave(id);waiting.get(id)?.reject(new Error('已取消保存'));};
      try{
        if(signal?.aborted)throw new Error('已取消保存');
        signal?.addEventListener('abort',aborted,{once:true});
        await new Promise((resolve,reject)=>{waiting.set(id,{resolve,reject});const error=window.ShiyingAndroid.beginSave(id,name,blob.type||'application/octet-stream',blob.size);if(error)reject(new Error(error));});
        waiting.delete(id);
        for(let offset=0;offset<blob.size;offset+=131072){
          if(signal?.aborted)throw new Error('已取消保存');
          const bytes=new Uint8Array(await blob.slice(offset,offset+131072).arrayBuffer());let binary='';
          for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
          const error=window.ShiyingAndroid.appendSave(id,btoa(binary));if(error)throw new Error(error);
        }
        const error=window.ShiyingAndroid.finishSave(id);if(error)throw new Error(error);
      }catch(error){window.ShiyingAndroid.abortSave(id);throw error;}
      finally{waiting.delete(id);signal?.removeEventListener('abort',aborted);}
    }
  };
})();
