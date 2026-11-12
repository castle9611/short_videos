import assert from 'node:assert/strict';
import {createLoginHelper} from '../scripts/douyin-login.mjs';
const secret='test-only-secret-'.repeat(3);let clearCount=0,closeCount=0,launches=0;
const fakeBrowser={async launchPersistentContext(profile,options){launches++;assert.ok(profile.endsWith('1'));assert.equal(options.headless,false);return {pages:()=>[{async goto(url){assert.equal(url,'https://www.douyin.com/');},async bringToFront(){}}],on(){},async cookies(){return [{name:'sessionid',value:'test-cookie',domain:'.douyin.com',expires:-1},{name:'third-party',value:'ignored',domain:'.example.com'}];},async clearCookies(){clearCount++;},async close(){closeCount++;}};}};
const helper=createLoginHelper({secret,profileRoot:'.runtime/test-login-profiles',browserType:fakeBrowser});await new Promise(resolve=>helper.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+helper.server.address().port;
async function call(path,body={userId:1},headers={}){const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Helper-Secret':secret,...headers},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
try{
  assert.equal((await call('/status',{userId:1},{'X-Helper-Secret':'wrong'})).status,403);
  assert.equal((await call('/status',{userId:1},{Origin:'https://evil.example'})).status,403);
  assert.equal((await call('/status',{userId:'../1'})).status,400);
  assert.equal((await call('/start')).data.state,'opening');
  const deadline=Date.now()+5000;let status;
  do{status=(await call('/status')).data;if(status.state!=='opening')break;await new Promise(resolve=>setTimeout(resolve,20));}while(Date.now()<deadline);
  assert.equal(status.state,'connected');assert.equal(status.cookie,undefined);
  assert.equal((await call('/cookie')).data.cookie,'sessionid=test-cookie');assert.equal((await call('/status',{userId:2})).data.state,'disconnected');
  assert.equal((await call('/disconnect')).data.state,'disconnected');assert.equal(clearCount,1);assert.equal(closeCount,1);assert.equal(launches,1);
  console.log('PASS: login helper authentication, origin checks, per-user isolation, credential redaction and disconnect');
}finally{await helper.shutdown();}
