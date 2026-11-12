import assert from 'node:assert/strict';
import {downloadMedia} from '../cloudflare/media.mjs';
const size=101*1024*1024+7,asset={url:'https://v.a.yximgs.com/large.mp4',name:'large.mp4'};
const db={prepare:()=>({bind:()=>({first:async()=>asset})})},original=globalThis.fetch;
try{
  for(const known of [true,false]){
    let sent=0;const chunk=new Uint8Array(1024*1024);
    globalThis.fetch=async()=>new Response(new ReadableStream({pull(controller){if(sent===size){controller.close();return;}const n=Math.min(chunk.length,size-sent);sent+=n;controller.enqueue(chunk.subarray(0,n));}}),{headers:{'Content-Type':'video/mp4',...(known?{'Content-Length':String(size)}:{})}});
    const response=await downloadMedia(db,1,{id:'a'.repeat(32)},{'Content-Type':'application/json'});assert.equal(response.status,200);const reader=response.body.getReader();let received=0;
    while(true){const {done,value}=await reader.read();if(done)break;received+=value.length;}
    assert.equal(received,size);
  }
  console.log('PASS: cloud proxy streams files above the old 100 MB limit with/without Content-Length');
}finally{globalThis.fetch=original;}
