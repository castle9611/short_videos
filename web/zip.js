// Standard ZIP stored entries, CRC-32 and UTF-8 filenames. No external dependency.
window.DownloadZip = (() => {
  const table = Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc(bytes){let value=0xffffffff;for(const b of bytes)value=table[(value^b)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
  function record(length){const bytes=new Uint8Array(length);return {bytes,view:new DataView(bytes.buffer)};}
  async function create(entries){
    if(!entries.length||entries.length>100)throw new Error('每次打包请选择 1–100 个文件');
    const files=[],directory=[];let offset=0;
    for(const entry of entries){
      if(entry.blob.size>=0xffffffff||offset>=0xffffffff)throw new Error('浏览器 ZIP32 格式无法容纳这些文件，请使用 APK 打包或逐个下载');
      const data=new Uint8Array(await entry.blob.arrayBuffer());
      const name=new TextEncoder().encode(entry.name.replace(/[\\/]/g,'_'));const checksum=crc(data);
      const local=record(30);local.view.setUint32(0,0x04034b50,true);local.view.setUint16(4,20,true);local.view.setUint16(6,0x800,true);local.view.setUint16(12,33,true);local.view.setUint32(14,checksum,true);local.view.setUint32(18,data.length,true);local.view.setUint32(22,data.length,true);local.view.setUint16(26,name.length,true);
      files.push(local.bytes,name,entry.blob);
      const central=record(46);central.view.setUint32(0,0x02014b50,true);central.view.setUint16(4,20,true);central.view.setUint16(6,20,true);central.view.setUint16(8,0x800,true);central.view.setUint16(14,33,true);central.view.setUint32(16,checksum,true);central.view.setUint32(20,data.length,true);central.view.setUint32(24,data.length,true);central.view.setUint16(28,name.length,true);central.view.setUint32(42,offset,true);
      directory.push(central.bytes,name);offset+=30+name.length+data.length;
    }
    const size=directory.reduce((n,p)=>n+p.length,0),end=record(22);if(offset>=0xffffffff)throw new Error('浏览器 ZIP32 格式无法容纳这些文件，请使用 APK 打包或逐个下载');end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,entries.length,true);end.view.setUint16(10,entries.length,true);end.view.setUint32(12,size,true);end.view.setUint32(16,offset,true);
    return new Blob([...files,...directory,end.bytes],{type:'application/zip'});
  }
  return {create};
})();
