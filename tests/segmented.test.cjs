const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../extension/segmented-audio.js'),'utf8'));
function buffer(seconds=10){return {duration:seconds,sampleRate:48000,length:seconds*48000,numberOfChannels:6};}
function context(){const records=[];return{state:'running',currentTime:0,destination:{},records,
 createGain(){return{gain:{setValueAtTime(value){this.value=value;}},connect(){},disconnect(){}};},
 createBufferSource(){const node={playbackRate:{value:1},connect(){},disconnect(){},stop(){this.stopped=true;},start(...args){this.startArgs=args;}};records.push(node);return node;}};}
test('25-minute seek retains at most three decoded intervals',()=>{
 const cache=new SurroundCache();for(let i=0;i<151;i++){cache.put(i,buffer(),i);assert.ok(cache.map.size<=3);assert.ok(cache.bytes<=96*1024*1024);}
 cache.put(2,buffer(),2);cache.put(3,buffer(),2);cache.put(4,buffer(),2);
 assert.deepEqual([...cache.map.keys()].sort((a,b)=>a-b),[2,3,4]);
});
test('adjacent intervals are scheduled on the same clock without a reload gap',()=>{
 const ctx=context(),cache=new SurroundCache(),renderer=new SurroundRenderer(ctx),groups=[0,1,2].map(id=>({id,start:id*10,end:(id+1)*10}));
 cache.put(0,buffer(),0);cache.put(1,buffer(),0);
 assert.equal(renderer.render(2,1,0,groups,cache,.6,false),true);
 assert.deepEqual(ctx.records.map(n=>n.startArgs),[[0,2,8],[8,0,10]]);
 ctx.currentTime=8;renderer.render(10,1,1,groups,cache);
 assert.equal(ctx.records.length,2);assert.equal(renderer.position(),10);
});
test('crossing a boundary evicts the past, keeping both prefetched forward intervals',()=>{
 const cache=new SurroundCache();for(const id of [125,126,127])cache.put(id,buffer(),125);
 cache.put(128,buffer(),126);
 assert.deepEqual([...cache.map.keys()],[126,127,128]);
 assert.equal(cache.has(128),true);
});
test('a cache-budget rejection is reported so callers do not repeatedly prefetch it',()=>{
 const cache=new SurroundCache(3,buffer().length*6*4*2);
 assert.equal(cache.put(0,buffer(),0),true);assert.equal(cache.put(1,buffer(),0),true);
 assert.equal(cache.put(2,buffer(),0),false);assert.deepEqual([...cache.map.keys()],[0,1]);
});
test('seek cancels old sources and starts only at the target offset',()=>{
 const ctx=context(),cache=new SurroundCache(),renderer=new SurroundRenderer(ctx),groups=Array.from({length:151},(_,id)=>({id,start:id*10,end:(id+1)*10}));
 cache.put(0,buffer(),0);renderer.render(2,1,0,groups,cache);
 const old=ctx.records[0];cache.put(125,buffer(),125);renderer.render(1256,1,125,groups,cache);
 assert.equal(old.stopped,true);assert.deepEqual(ctx.records.at(-1).startArgs,[0,6,4]);
 renderer.stop();assert.equal(renderer.nodes.size,0);assert.equal(renderer.position(),null);
});
test('missing data falls back and rate changes rebuild the schedule',()=>{
 const ctx=context(),cache=new SurroundCache(),renderer=new SurroundRenderer(ctx),groups=[{id:0,start:0,end:10}];
 assert.equal(renderer.render(0,1,0,groups,cache),false);cache.put(0,buffer(),0);
 renderer.render(2,1,0,groups,cache);renderer.render(2,2,0,groups,cache,1,true);
 assert.equal(ctx.records.at(-1).playbackRate.value,2);assert.equal(renderer.gain.gain.value,0);
});
