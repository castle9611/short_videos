(() => {
  if (!window.ShiyingAndroid) return;
  const waiting=new Map();
  window.ShiyingDownloads={
    onReady(id){waiting.get(id)?.resolve();},
    onError(id,message){waiting.get(id)?.reject(new Error(message));},
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
