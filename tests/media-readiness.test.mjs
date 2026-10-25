import {test} from 'node:test';import assert from 'node:assert/strict';
import {readInitialMedia} from '../src/network.js';
const forbidden=()=>Object.assign(new Error('HTTP 403'),{status:403});
test('an immediately available initial range has no waiting or extra request',async()=>{
 let calls=0;const bytes=new Uint8Array([1,2]);
 assert.equal(await readInitialMedia(async()=>{calls++;return bytes;},{delay:async()=>assert.fail('unnecessary wait')}),bytes);assert.equal(calls,1);
});
test('a fresh media URL gets two bounded readiness retries without reacquiring it',async()=>{
 const delays=[],addresses=[],address='https://example.googlevideo.com/videoplayback?range=0-682';let calls=0;
 const result=await readInitialMedia(async()=>{addresses.push(address);if(++calls<3)throw forbidden();return 'ready';},{delay:async ms=>delays.push(ms)});
 assert.equal(result,'ready');assert.equal(calls,3);assert.deepEqual(delays,[3000,4000]);assert.deepEqual(addresses,[address,address,address]);
});
test('a persistent initial 403 stops after the readiness budget',async()=>{
 let calls=0;const delays=[];
 await assert.rejects(readInitialMedia(async()=>{calls++;throw forbidden();},{delay:async ms=>delays.push(ms)}),e=>e.status===403);
 assert.equal(calls,3);assert.deepEqual(delays,[3000,4000]);
});
for(const status of [429,410,500])test(`readiness does not retry HTTP ${status}`,async()=>{
 let calls=0;await assert.rejects(readInitialMedia(async()=>{calls++;throw Object.assign(new Error('HTTP error'),{status});},{delay:async()=>assert.fail('must not wait')}),e=>e.status===status);assert.equal(calls,1);
});
test('turning off or seeking cancels the readiness wait before another request',async()=>{
 const abort=new AbortController(),reason=new Error('seek cancelled');let calls=0;
 await assert.rejects(readInitialMedia(async()=>{calls++;throw forbidden();},{signal:abort.signal,delay:async()=>{abort.abort(reason);}}),e=>e===reason);assert.equal(calls,1);
});
test('a cancelled operation makes no initial media request',async()=>{
 const abort=new AbortController();abort.abort(new Error('disabled'));
 await assert.rejects(readInitialMedia(async()=>assert.fail('cancelled request'),{signal:abort.signal}),/disabled/);
});
