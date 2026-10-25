const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
for(const file of ['segmented-audio.js','atmos-renderer.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../extension',file),'utf8'));
test('HRTF keeps the five speaker channels separate and handles LFE independently',()=>{
 const nodes=[];
 function node(kind){const n={kind,links:[],gain:{value:1},positionX:{},positionY:{},positionZ:{},frequency:{},Q:{},connect(...args){this.links.push(args);},disconnect(){this.disconnected=true;}};nodes.push(n);return n;}
 const context={destination:node('destination'),createGain:()=>node('gain'),createChannelSplitter:()=>node('splitter'),createPanner:()=>node('panner'),createBiquadFilter:()=>node('filter'),createChannelMerger:()=>node('merger')};
 const renderer=new SurroundRenderer(context,{mode:'hrtf'}),panners=nodes.filter(n=>n.kind==='panner'),splitter=nodes.find(n=>n.kind==='splitter');
 assert.equal(panners.length,5);assert.ok(panners.every(p=>p.panningModel==='HRTF'&&p.channelCount===1));
 assert.deepEqual(splitter.links.map(link=>link[1]),[0,1,2,4,5,3]);
 assert.ok(panners[0].positionX.value<0&&panners[0].positionZ.value<0);
 assert.ok(panners[3].positionX.value<0&&panners[3].positionZ.value>0);
 assert.equal(nodes.find(n=>n.kind==='filter').frequency.value,120);
 renderer.dispose();assert.ok(panners.every(n=>n.disconnected));
});
class EventHook{constructor(){this.listeners=[];}addListener(fn){this.listeners.push(fn);}emit(value){for(const fn of this.listeners)fn(value);}}
function port(){return {onMessage:new EventHook(),onDisconnect:new EventHook(),messages:[],postMessage(data){this.messages.push(data);},disconnect(){this.disconnected=true;}};}
function audio(frames=8){const planes=Array.from({length:6},(_,ch)=>new Float32Array(frames).fill((ch+1)/10));return {length:frames,duration:frames/48000,sampleRate:48000,numberOfChannels:6,getChannelData:ch=>planes[ch]};}
test('Atmos transfer retains all six PCM channels and waits for the matching native acknowledgement',()=>{
 const p=port();global.chrome={runtime:{id:'test',connect:()=>p}};
 const r=new AtmosRenderer();p.onMessage.emit({type:'info',available:true});const cache=new SurroundCache(),buffer=audio();cache.put(0,buffer,0);const groups=[{start:0,end:buffer.duration}];
 assert.equal(r.render(0,1,0,groups,cache),false);
 const block=p.messages.find(m=>m.type==='chunk'),bytes=Buffer.from(block.data,'base64');
 for(let ch=0;ch<6;ch++)assert.ok(Math.abs(bytes.readFloatLE(ch*4)-(ch+1)/10)<1e-6);
 const commit=p.messages.find(m=>m.type==='commit');p.onMessage.emit({type:'cached',id:0,uploadId:commit.uploadId-1});assert.equal(r.uploaded.size,0);
 p.onMessage.emit({type:'cached',id:0,uploadId:commit.uploadId});assert.equal(r.render(0,1,0,groups,cache,.4,false),true);
 const state=p.messages.at(-1);assert.equal(state.type,'state');assert.equal(state.volume,.4);r.dispose();assert.equal(p.disconnected,true);
});
test('turning Atmos off during an upload cancels remaining blocks and cannot commit stale audio',async()=>{
 const p=port();global.chrome={runtime:{id:'test',connect:()=>p}};
 const r=new AtmosRenderer();p.onMessage.emit({type:'info',available:true});const cache=new SurroundCache(),buffer=audio(30000);cache.put(0,buffer,0);
 r.render(0,1,0,[{start:0,end:buffer.duration}],cache);r.stop(true);
 await new Promise(resolve=>setTimeout(resolve,15));
 assert.ok(p.messages.some(m=>m.type==='abort'));assert.ok(!p.messages.some(m=>m.type==='commit'));r.dispose();
});
test('native disconnection reports unavailable instead of pretending Dolby is active',()=>{
 const p=port();global.chrome={runtime:{id:'test',connect:()=>p}};const r=new AtmosRenderer();
 p.onMessage.emit({type:'disconnected',message:'host not found'});assert.equal(r.available,false);assert.match(r.status(),/Install\.cmd/);r.dispose();
});
test('disposing an invalidated extension port is idempotent and leaves no active upload',()=>{
 const p=port();p.disconnect=()=>{throw new Error('Extension context invalidated.');};
 global.chrome={runtime:{id:'test',connect:()=>p}};const r=new AtmosRenderer();r.uploaded.set(0,{});r.uploading={id:0};
 assert.doesNotThrow(()=>r.dispose());assert.equal(r.port,null);assert.equal(r.alive,false);assert.equal(r.uploading,null);assert.equal(r.uploaded.size,0);assert.doesNotThrow(()=>r.dispose());
});
test('late native disconnect ignores disposed contexts and safely reads invalidated runtime errors',()=>{
 const p=port(),runtime={id:'test',connect:()=>p};global.chrome={runtime};
 Object.defineProperty(runtime,'lastError',{get(){throw new Error('Extension context invalidated.');}});
 const r=new AtmosRenderer();assert.doesNotThrow(()=>p.onDisconnect.emit());assert.equal(r.available,false);assert.match(r.status(),/YouTubeページを再読み込み/);
 r.dispose();assert.doesNotThrow(()=>p.onDisconnect.emit());
});
