import {test} from 'node:test';import assert from 'node:assert/strict';
import {createNetwork,describe} from '../src/network.js';
const url='https://test.googlevideo.com/videoplayback';
test('temporary server error retries once and returns the new response',async()=>{
 let calls=0,delays=0;const net=createNetwork({fetcher:async()=>++calls===1?new Response('',{status:503}):new Response('ok'),delay:async()=>delays++});
 assert.equal(await net(url,{},r=>r.text()),'ok');assert.equal(calls,2);assert.equal(delays,1);
});
for(const status of [403,429])test(`HTTP ${status} is never retried by the network layer`,async()=>{
 let calls=0;const net=createNetwork({fetcher:async()=>{calls++;return new Response('',{status});},delay:async()=>assert.fail('must not retry')});
 await assert.rejects(net(url),e=>e.status===status);assert.equal(calls,1);
});
test('body failures retry the complete range instead of returning truncated bytes',async()=>{
 let calls=0;const net=createNetwork({fetcher:async()=>{calls++;return calls===1?new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.error(new TypeError('connection reset'));}})):new Response(new Uint8Array([1,2]));},delay:async()=>{}});
 assert.deepEqual([...new Uint8Array(await net(url,{},r=>r.arrayBuffer()))],[1,2]);assert.equal(calls,2);
});
test('repeated network failure stops after two attempts',async()=>{
 let calls=0;const net=createNetwork({fetcher:async()=>{calls++;throw new TypeError('offline');},delay:async()=>{}});
 await assert.rejects(net(url),/offline/);assert.equal(calls,2);
});
test('user cancellation does not retry and preserves the cancellation reason',async()=>{
 const abort=new AbortController();let calls=0;
 const net=createNetwork({signal:abort.signal,fetcher:async()=>{calls++;abort.abort(new Error('seek cancelled'));throw new TypeError('aborted');},delay:async()=>assert.fail('must not retry')});
 await assert.rejects(net(url),/seek cancelled/);assert.equal(calls,1);
});
test('timeouts cover response body consumption and are bounded',async()=>{
 const keepAlive=setTimeout(()=>{},1000);let calls=0;
 try{const net=createNetwork({timeoutMs:10,delay:async()=>{},fetcher:async(_url,{signal})=>{calls++;return {ok:true,read:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))};}});
 await assert.rejects(net(url,{},r=>r.read()),e=>e.name==='TimeoutError');assert.equal(calls,2);
 }finally{clearTimeout(keepAlive);}
});
test('error messages identify the stage without exposing signed media URLs',()=>{
 const error=describe(Object.assign(new Error('HTTP 403'),{status:403}),'音声328の初期化領域取得');assert.equal(error.status,403);assert.match(error.message,/初期化領域取得/);assert.match(error.message,/アクセスを拒否/);
});
