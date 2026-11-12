import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
await mkdir('.runtime',{recursive:true});
const directory=await mkdtemp(path.resolve('.runtime/native-test-'));
const bin=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name+(process.platform==='win32'?'.exe':'')):name;
function run(name,args){const result=spawnSync(bin(name),args,{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${name} failed (${result.status})`);}
try{
  run('javac',['-encoding','UTF-8','--release','8','-d',directory,'android/app/src/main/java/cn/shiying/studio/Backend.java','android/app/src/main/java/cn/shiying/studio/MediaTransfer.java','tests/MediaTransferTest.java']);
  run('java',['-cp',directory,'cn.shiying.studio.MediaTransferTest']);
}finally{await rm(directory,{recursive:true,force:true});}
