/* Web Audio schedules consecutive PCM buffers on one clock, without an audio-element reload. */
globalThis.SurroundCache=class SurroundCache{
  constructor(maxEntries=3,maxBytes=96*1024*1024){this.map=new Map();this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.bytes=0;}
  get(id){return this.map.get(id)?.buffer;}
  has(id){return this.map.has(id);}
  clear(){this.map.clear();this.bytes=0;}
  put(id,buffer,current){
    const size=buffer.length*buffer.numberOfChannels*4;
    if(size>this.maxBytes)throw new Error('1区間の音声がキャッシュ上限を超えています。');
    if(this.map.has(id)){this.bytes-=this.map.get(id).size;this.map.delete(id);}
    this.map.set(id,{buffer,size});this.bytes+=size;this.prune(current);return this.map.has(id);
  }
  prune(current){
    // Keep the current interval and the nearest forward intervals, evicting distant seeks first.
    while(this.map.size>this.maxEntries||this.bytes>this.maxBytes){
      const ids=[...this.map.keys()].filter(id=>id!==current);
      if(!ids.length)break;
      ids.sort((a,b)=>{const score=x=>x<current?100000+current-x:x-current;return score(b)-score(a);});
      const victim=ids[0];this.bytes-=this.map.get(victim).size;this.map.delete(victim);
    }
  }
};
globalThis.SurroundRenderer=class SurroundRenderer{
  constructor(context,{mode='direct'}={}){
    this.context=context;this.gain=context.createGain();this.nodes=new Map();this.anchor=null;this.graph=[];
    if(mode==='hrtf'){
      const splitter=context.createChannelSplitter(6),headroom=context.createGain();
      splitter.channelInterpretation='discrete';headroom.gain.value=0.5;headroom.connect(context.destination);this.gain.connect(splitter);
      this.graph.push(splitter,headroom);
      // Web Audio channel order: FL, FR, C, LFE, SL, SR. Listener looks along -Z.
      for(const [channel,degrees] of [[0,-30],[1,30],[2,0],[4,-110],[5,110]]){
        const panner=context.createPanner();panner.panningModel='HRTF';panner.channelCount=1;panner.channelCountMode='explicit';
        panner.distanceModel='inverse';panner.rolloffFactor=0;
        const radians=degrees*Math.PI/180;panner.positionX.value=Math.sin(radians);panner.positionY.value=0;panner.positionZ.value=-Math.cos(radians);
        splitter.connect(panner,channel,0);panner.connect(headroom);this.graph.push(panner);
      }
      // LFE has no reliable direction cue. Low-pass it and send equal energy to both ears.
      const low=context.createBiquadFilter(),lfeGain=context.createGain(),stereo=context.createChannelMerger(2);
      low.type='lowpass';low.frequency.value=120;low.Q.value=0.707;lfeGain.gain.value=0.5;
      splitter.connect(low,3,0);low.connect(lfeGain);lfeGain.connect(stereo,0,0);lfeGain.connect(stereo,0,1);stereo.connect(headroom);
      this.graph.push(low,lfeGain,stereo);
    }else this.gain.connect(context.destination);
  }
  stop(){for(const node of this.nodes.values()){try{node.stop();}catch{}node.disconnect();}this.nodes.clear();this.anchor=null;}
  position(){return this.anchor?this.anchor.media+(this.context.currentTime-this.anchor.clock)*this.anchor.rate:null;}
  render(time,rate,current,groups,cache,volume=1,muted=false){
    if(!cache.has(current)||this.context.state!=='running'){this.stop();return false;}
    if(!Number.isFinite(rate)||rate<=0||!Number.isFinite(time)){this.stop();return false;}
    const g=groups[current],b=cache.get(current);
    if(time>=g.start+b.duration-1/b.sampleRate){this.stop();return false;}
    if(!this.anchor||this.anchor.rate!==rate||Math.abs(this.position()-time)>0.10){
      this.stop();this.anchor={media:time,clock:this.context.currentTime,rate};
    }
    const gain=muted?0:Math.max(0,Math.min(1,volume));
    if(this.gain.gain.value!==gain)this.gain.gain.value=gain;
    for(const [id,node] of this.nodes){if(id<current||id>current+2){try{node.stop();}catch{}node.disconnect();this.nodes.delete(id);}}
    for(let id=current;id<Math.min(groups.length,current+3);id++){
      if(this.nodes.has(id)||!cache.has(id))continue;
      const group=groups[id],buffer=cache.get(id);
      const start=Math.max(time,group.start),offset=Math.max(0,start-group.start);
      const duration=Math.min(group.end-start,buffer.duration-offset);
      if(duration<=0)continue;
      const node=this.context.createBufferSource();node.buffer=buffer;node.playbackRate.value=rate;node.connect(this.gain);
      node.onended=()=>{if(this.nodes.get(id)===node)this.nodes.delete(id);node.disconnect();};
      const when=Math.max(this.context.currentTime,this.anchor.clock+(start-this.anchor.media)/rate);
      node.start(when,offset,duration);this.nodes.set(id,node);
    }
    return true;
  }
  dispose(){this.stop();this.gain.disconnect();for(const node of this.graph)node.disconnect();}
};
