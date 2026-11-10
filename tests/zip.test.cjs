const fs=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');const os=require('node:os');const path=require('node:path');
const context=vm.createContext({window:{},Blob,Uint8Array,Uint32Array,DataView,TextEncoder});
vm.runInContext(fs.readFileSync('web/zip.js','utf8'),context);
(async()=>{
  const entries=[{name:'图集_01.jpg',blob:new Blob(['sample-image'])},{name:'work/video.mp4',blob:new Blob([new Uint8Array([0,1,2,255])])}];
  const blob=await context.window.DownloadZip.create(entries);assert.equal(blob.type,'application/zip');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shiying-zip-'));const filename=path.join(temp,'test.zip');
  try{fs.writeFileSync(filename,Buffer.from(await blob.arrayBuffer()));const result=spawnSync('python',['-c',`import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert len(z.namelist())==2; assert z.read(z.namelist()[0])==b'sample-image'; assert z.read('work_video.mp4')==bytes([0,1,2,255]); print('PASS: ZIP headers, UTF-8 names, CRC-32, file contents and path sanitization')`,filename],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);console.log(result.stdout.trim());}
  finally{fs.unlinkSync(filename);fs.rmdirSync(temp);}
})().catch(e=>{console.error(e);process.exitCode=1;});
