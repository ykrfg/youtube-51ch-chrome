const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function boot(storage,initialMuted=false,cached=true,settings={}){
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.dataset={};this.attributes={};this.textContent='';this.isConnected=true;}
  addEventListener(name,fn){this.events[name]=fn;}
  setAttribute(k,v){this.attributes[k]=v;}
  append(...children){for(const child of children)if(typeof child==='object'){child.parentElement=this;this.children.push(child);}}
  prepend(child){this.append(child);}
  remove(){this.isConnected=false;}
 }
 const body=new Element('body'),below=new Element('div'),player=new Element('div');player.parentElement=body;
 const video=Object.assign(new Element('video'),{muted:initialMuted,readyState:4,duration:30,currentTime:2,paused:false,volume:1,playbackRate:1});
 const elements=[],windowEvents={},documentEvents={};
 const document={body,addEventListener(name,fn){documentEvents[name]=fn;},createTextNode:text=>({textContent:text}),createElement(tag){const e=new Element(tag);if(tag==='iframe')e.contentWindow={postMessage(){}};elements.push(e);return e;},querySelector(selector){
  if(selector==='#movie_player video.html5-main-video')return video;if(selector==='#movie_player')return player;if(selector==='#below')return below;return null;
 }};
 class AudioContext{constructor(){this.state='running';this.destination={maxChannelCount:2};}addEventListener(){}async resume(){}async close(){}}
 const renderers=[];class Renderer{constructor(){renderers.push(this);}stop(){}dispose(){this.disposed=true;}render(){return cached;}}
 class Cache{clear(){}prune(){}has(){return cached;}}
 let clock=0,timerId=0;const intervals=[],timers=new Map();
 const scope={document,window:{sessionStorage:storage,addEventListener:(n,fn)=>windowEvents[n]=fn},location:{href:'https://www.youtube.com/watch?v=testVideo01',pathname:'/watch'},URL,
  chrome:{runtime:{getURL:n=>'chrome-extension://test/'+n},storage:{local:{async get(d){return {...d,...settings};}}}},AudioContext,SurroundRenderer:Renderer,AtmosRenderer:Renderer,SurroundCache:Cache,
  Date:{now:()=>clock},setInterval(fn){intervals.push(fn);},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout(id){timers.delete(id);},MessageChannel:class{constructor(){this.port1={messages:[],postMessage(data){this.messages.push(data);},start(){},close(){this.closed=true;}};this.port2={};scope.lastPort=this.port1;}}};
 vm.createContext(scope);for(const name of ['mute-recovery.js','controller.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension',name),'utf8'),scope);
 const panel=elements.find(e=>e.tag==='section'),toggle=panel.children.find(e=>e.tag==='button');
 return {video,toggle,scope,storage,windowEvents,documentEvents,elements,renderers,status:elements.find(e=>e.dataset.role==='status'),poll(){intervals[0]();},advance(ms){clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}intervals[0]();intervals[1]();},async start(){toggle.events.click();await new Promise(setImmediate);
  elements.findLast(e=>e.tag==='iframe').events.load();
 },async enable(){await this.start();
  await scope.lastPort.onmessage({data:{type:'opened',groups:[{start:0,end:30}],channels:6,duration:30,formatId:328}});
 }};
}
test('controller reload restores original mute and its on/off state is never inverted',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const first=boot(storage);await first.enable();assert.equal(first.toggle.textContent,'5.1ch：オン');assert.equal(first.video.muted,true);
 first.windowEvents.pagehide();assert.equal(first.video.muted,false,'unload restores the original audio state');assert.equal(values.size,1,'recovery must survive unload');
 // YouTube can restore the mute it observed while the replacement track was active.
 const second=boot(storage,true);assert.equal(second.video.muted,false);assert.equal(second.toggle.attributes['aria-pressed'],'false');
 await second.enable();assert.equal(second.toggle.textContent,'5.1ch：オン');assert.equal(second.toggle.attributes['aria-pressed'],'true');assert.equal(second.video.muted,true);
 second.toggle.events.click();assert.equal(second.toggle.textContent,'5.1ch：オフ');assert.equal(second.toggle.attributes['aria-pressed'],'false');assert.equal(second.video.muted,false);assert.equal(values.size,0);
});

test('automatic Atmos 5.1 to 5.1 navigation releases the old session and waits for navigation finish',async()=>{
 const app=boot(undefined,false,true,{autoEnable:true,mode:'atmos'});await new Promise(setImmediate);
 let frames=()=>app.elements.filter(e=>e.tag==='iframe');frames().at(-1).events.load();const oldPort=app.scope.lastPort;
 const opened={type:'opened',groups:[{start:0,end:30}],channels:6,duration:30,formatId:328};await oldPort.onmessage({data:opened});assert.equal(app.video.muted,true);assert.equal(app.toggle.textContent,'5.1ch：オン');
 app.documentEvents['yt-navigate-start']();assert.equal(oldPort.closed,true);assert.equal(app.video.muted,false);assert.equal(app.renderers[0].disposed,true);
 app.scope.location.href='https://www.youtube.com/watch?v=testVideo02';app.poll();await new Promise(setImmediate);assert.equal(frames().length,1,'no opening before navigation finishes');
 app.documentEvents['yt-navigate-finish']();await new Promise(setImmediate);assert.equal(frames().length,2);frames().at(-1).events.load();const nextPort=app.scope.lastPort;
 assert.equal(nextPort.messages.find(x=>x.type==='open').videoId,'testVideo02');
 await oldPort.onmessage({data:{type:'progress',message:'stale old video'}});assert.notEqual(app.status.textContent,'stale old video');
 await nextPort.onmessage({data:opened});assert.equal(app.toggle.textContent,'5.1ch：オン');assert.equal(app.video.muted,true);
});

test('an opening frame lost after progress is rebuilt once without leaving the UI stuck',async()=>{
 const app=boot(undefined,false,true,{autoEnable:true,mode:'atmos'});await new Promise(setImmediate);
 const frames=()=>app.elements.filter(e=>e.tag==='iframe');frames().at(-1).events.load();const first=app.scope.lastPort;
 await first.onmessage({data:{type:'progress',message:'元の328 / 6ch音声の区間索引を取得しています…'}});
 frames().at(-1).remove();app.poll();await new Promise(setImmediate);assert.equal(frames().length,2);assert.equal(first.closed,true);assert.equal(app.video.muted,false);
 frames().at(-1).events.load();const retry=app.scope.lastPort;await retry.onmessage({data:{type:'progress',message:'retrying'}});
 frames().at(-1).remove();app.poll();await new Promise(setImmediate);assert.equal(frames().length,2,'automatic recovery is bounded');assert.match(app.status.textContent,/標準音声に戻しました/);assert.equal(app.toggle.textContent,'5.1chを有効にする');
 app.poll();assert.equal(frames().length,2,'auto-enable must not loop after recovery failed');
});

test('progress does not remove the stall deadline and manual cancellation prevents recovery',async()=>{
 const app=boot(undefined,false,true,{autoEnable:true,mode:'atmos'});await new Promise(setImmediate);
 const frames=()=>app.elements.filter(e=>e.tag==='iframe');frames().at(-1).events.load();
 await app.scope.lastPort.onmessage({data:{type:'progress',message:'waiting for index'}});
 app.advance(35000);await new Promise(setImmediate);assert.equal(frames().length,2,'stalled after progress gets one recovery');
 app.toggle.events.click();app.advance(120000);await new Promise(setImmediate);assert.equal(frames().length,2);assert.equal(app.video.muted,false);assert.match(app.status.textContent,/キャンセル/);
});
test('initial HTTP 403 leaves standard audio and reports the failing stage',async()=>{
 const app=boot(undefined);await app.start();
 await app.scope.lastPort.onmessage({data:{type:'error',status:403,message:'音声328の初期化領域取得：HTTP 403'}});
 assert.equal(app.video.muted,false);assert.equal(app.toggle.attributes['aria-pressed'],'false');
});
test('persistent HTTP 403 during playback stops automatic requests and restores standard audio',async()=>{
 const app=boot(undefined,false,false);await app.enable();
 const port=app.scope.lastPort,request=port.messages.find(m=>m.type==='segment');assert.ok(request);
 await port.onmessage({data:{type:'error',fatal:true,status:403,requestId:request.requestId,message:'区間取得：HTTP 403'}});
 const count=port.messages.filter(m=>m.type==='segment').length;app.advance(60000);
 assert.equal(port.messages.filter(m=>m.type==='segment').length,count);assert.equal(app.video.muted,false);assert.equal(app.toggle.textContent,'5.1ch：オフ');
});
test('repeated interval errors use backoff then stop after the third failure',async()=>{
 const app=boot(undefined,false,false);await app.enable();const port=app.scope.lastPort;
 for(let attempt=0;attempt<3;attempt++){
  const request=port.messages.findLast(m=>m.type==='segment');
  await port.onmessage({data:{type:'error',requestId:request.requestId,message:'通信タイムアウト'}});
  const count=port.messages.filter(m=>m.type==='segment').length;app.advance(attempt===0?4999:9999);
  assert.equal(port.messages.filter(m=>m.type==='segment').length,count);
  if(attempt<2){app.advance(1);assert.equal(port.messages.filter(m=>m.type==='segment').length,count+1);}
 }
 assert.equal(app.toggle.textContent,'5.1ch：オフ');assert.equal(app.video.muted,false);
});
