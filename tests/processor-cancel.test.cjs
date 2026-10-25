const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function boot(openStream=()=>{}){
 const events=new Map(),timers=new Map();let timerId=0,load;
 const solver={addEventListener(_name,fn){load=fn;},contentWindow:{postMessage(){}}},parent={};
 const scope={parent,window:{addEventListener(name,fn){events.set(name,fn);},removeEventListener(name){events.delete(name);}},document:{getElementById:()=>solver},openStream,
  AbortController,AbortSignal,DOMException,setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
  MessageChannel:class{constructor(){this.port1={postMessage(){}};this.port2={};}}};
 vm.createContext(scope);let source=fs.readFileSync(path.join(__dirname,'../src/processor.js'),'utf8').replace("import {openStream} from './extractor.js';",'');vm.runInContext(source,scope);
 return {scope,events,timers,parent,load:()=>load(),pending:()=>vm.runInContext('pending.size',scope)};
}
test('navigation aborts URL solver connection waiting and clears its timeout',async()=>{
 const app=boot(),abort=new AbortController(),reason=new Error('navigation');const operation=app.scope.evaluate({output:'code'},abort.signal);
 abort.abort(reason);await assert.rejects(operation,e=>e===reason);assert.equal(app.pending(),0);assert.equal(app.timers.size,0);
});
test('navigation removes an in-flight URL solver job and its timeout',async()=>{
 const app=boot();app.load();const abort=new AbortController(),reason=new Error('navigation');const operation=app.scope.evaluate({output:'code'},abort.signal);
 await new Promise(setImmediate);assert.equal(app.pending(),1);abort.abort(reason);await assert.rejects(operation,e=>e===reason);assert.equal(app.pending(),0);assert.equal(app.timers.size,0);
});
test('processor page teardown aborts acquisition even if its cancel message is lost',async()=>{
 let openingSignal;const app=boot((_id,{signal})=>new Promise((_,reject)=>{openingSignal=signal;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}));
 const port={messages:[],postMessage(data){this.messages.push(data);},start(){},close(){this.closed=true;}};
 app.events.get('message')({source:app.parent,origin:'https://www.youtube.com',data:{type:'bind-surround'},ports:[port]});
 const opening=port.onmessage({data:{type:'open',videoId:'testVideo01'}});assert.equal(openingSignal.aborted,false);
 app.events.get('pagehide')();await opening;assert.equal(openingSignal.aborted,true);assert.equal(port.closed,true);assert.deepEqual(port.messages,[]);
});
