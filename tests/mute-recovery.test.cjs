const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../extension/mute-recovery.js'),'utf8'));
function storage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
const id='testVideo01';
test('reload recovers an unmuted preference even when YouTube persisted the extension mute',()=>{
 const s=storage(),before=new SurroundMuteRecovery(s);before.remember(id,false);
 const reloaded=new SurroundMuteRecovery(s),video={muted:true,readyState:4};reloaded.recover(id,video);
 assert.equal(video.muted,false);assert.equal(new SurroundMuteRecovery(s).pending,null);
 video.muted=true;reloaded.recover(id,video);assert.equal(video.muted,true,'later user mute must be preserved');
});
test('a user-requested mute survives reload and the next off/on cycle',()=>{
 const s=storage(),before=new SurroundMuteRecovery(s);before.remember(id,true);
 const after=new SurroundMuteRecovery(s),video={muted:false,readyState:4};after.recover(id,video);assert.equal(video.muted,true);
 after.remember(id,video.muted);assert.equal(new SurroundMuteRecovery(s).pending.muted,true);
});
test('recovery waits for the media element initialization',()=>{
 const s=storage(),before=new SurroundMuteRecovery(s);before.remember(id,false);
 const after=new SurroundMuteRecovery(s),video={muted:true,readyState:0};after.recover(id,video);assert.equal(video.muted,true);
 video.readyState=1;after.recover(id,video);assert.equal(video.muted,false);
});
test('a normal off clears the journal so future user changes are not overwritten',()=>{
 const s=storage(),before=new SurroundMuteRecovery(s);before.remember(id,false);before.forget();
 const video={muted:true,readyState:4};new SurroundMuteRecovery(s).recover(id,video);assert.equal(video.muted,true);
});
test('a different video does not inherit an old recovery record',()=>{
 const s=storage();new SurroundMuteRecovery(s).remember(id,false);
 const after=new SurroundMuteRecovery(s),video={muted:true,readyState:4};after.recover('AAAAAAAAAAA',video);
 assert.equal(video.muted,true);assert.equal(new SurroundMuteRecovery(s).pending,null);
});
test('unavailable or malformed session storage does not break playback controls',()=>{
 const unavailable={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 const r=new SurroundMuteRecovery(unavailable);r.remember(id,false);r.forget();r.recover(id,{muted:true,readyState:4});
 const malformed={getItem:()=>'{broken'};assert.equal(new SurroundMuteRecovery(malformed).pending,null);
});
