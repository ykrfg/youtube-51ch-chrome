globalThis.AtmosRenderer=class AtmosRenderer{
  constructor(){
    this.available=false;this.uploaded=new Map();this.uploading=null;this.alive=true;this.queue=[];this.retainKey='';this.active=false;this.uploadSequence=0;this.ids=[];
    this.message='Windows空間音響の補助プログラムに接続しています…';this.error=null;
    try{
      this.port=chrome.runtime.connect({name:'atmos-output'});
      this.port.onMessage.addListener(data=>{
        if(!this.alive)return;
        if(data.type==='info'){
          this.available=data.available;
          this.message=data.available?'Windows空間オーディオへ6ch出力（Dolby／DTSはWindows側で選択）':`Windowsの空間オーディオを確認してください：${data.message}`;
        }
        if(data.type==='cached'){
          if(this.uploading?.id===data.id&&this.uploading.token===data.uploadId){this.uploaded.set(data.id,this.uploading.buffer);this.uploading=null;this.pump();}
        }
        if(['error','device-error','disconnected'].includes(data.type)){
          this.available=false;this.active=false;
          this.stop(true);
          this.message=data.type==='disconnected'?`Windows空間音響の補助プログラムに接続できません。native/Install.cmdを実行してください（拡張機能ID：${chrome.runtime.id}）。 ${data.message}`:`Windows空間音響の出力エラー：${data.message}`;
          this.error=this.message;
        }
      });
      this.port.onDisconnect.addListener(()=>{
        if(!this.alive)return;
        let error;try{error=chrome.runtime.lastError;}catch{error={message:'拡張機能が更新されました。YouTubeページを再読み込みしてください。'};}
        this.available=false;this.active=false;this.stop(true);this.error=`Windows空間音響の接続が切れました：${error?.message||''}`;this.message=this.error;
      });
    }catch(error){this.message=`Windows空間音響の補助プログラムに接続できません：${error.message}`;this.error=this.message;}
  }
  status(){return this.uploading?'Windows空間音響：区間をWindowsへ転送中（YouTube標準音声で再生）':this.message;}
  send(data){if(!this.alive||!this.port)return;try{this.port.postMessage(data);}catch{this.available=false;this.active=false;}}
  async pump(){
    if(this.uploading||!this.available||!this.alive)return;
    const job=this.queue.shift();if(!job)return;job.token=++this.uploadSequence;this.uploading=job;
    const {buffer,id,start}=job,planes=Array.from({length:6},(_,ch)=>buffer.getChannelData(ch));
    this.send({type:'retain',ids:this.ids});
    this.send({type:'begin',id,uploadId:job.token,channels:6,sampleRate:buffer.sampleRate,frames:buffer.length,start});
    const framesPerBlock=4096;let offset=0,blocks=0;
    for(let frame=0;frame<buffer.length;frame+=framesPerBlock){
      if(!this.alive||this.uploading!==job)return;
      const n=Math.min(framesPerBlock,buffer.length-frame),interleaved=new Float32Array(n*6);
      for(let i=0;i<n;i++)for(let ch=0;ch<6;ch++)interleaved[i*6+ch]=planes[ch][frame+i];
      const bytes=new Uint8Array(interleaved.buffer);let binary='';
      for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
      this.send({type:'chunk',id,uploadId:job.token,offset,data:btoa(binary)});offset+=bytes.length;
      if(++blocks%4===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(this.alive&&this.uploading===job)this.send({type:'commit',id,uploadId:job.token});
  }
  stop(cancelUpload=false){this.active=false;this.send({type:'pause'});if(cancelUpload){this.queue=[];this.uploading=null;this.send({type:'abort'});}}
  position(){return null;}
  render(time,rate,current,groups,cache,volume=1,muted=false){
    if(!this.available||!this.alive){this.stop();return false;}
    if(!cache.has(current)){this.stop(true);return false;}
    const ids=this.ids=[...cache.map.keys()];const key=ids.join(',');
    if(key!==this.retainKey){this.retainKey=key;this.send({type:'retain',ids});for(const id of this.uploaded.keys())if(!ids.includes(id))this.uploaded.delete(id);}
    this.queue=this.queue.filter(job=>ids.includes(job.id));
    if(this.uploading&&(!ids.includes(this.uploading.id)||!this.uploaded.has(current)&&this.uploading.id!==current)){
      this.uploading=null;this.send({type:'abort'});
    }
    for(let id=current;id<Math.min(groups.length,current+3);id++){
      const buffer=cache.get(id);
      if(buffer&&this.uploaded.get(id)!==buffer&&this.uploading?.id!==id&&!this.queue.some(job=>job.id===id))this.queue.push({id,start:groups[id].start,buffer});
    }
    // A distant seek takes priority over a queued old prefetch.
    this.queue.sort((a,b)=>(a.id===current?-1:b.id===current?1:a.id-b.id));this.pump();
    if(!cache.has(current)||this.uploaded.get(current)!==cache.get(current)){this.stop();return false;}
    this.send({type:'state',time,rate,current,volume,muted,playing:true});this.active=true;return true;
  }
  dispose(){
    this.stop(true);this.alive=false;this.queue=[];this.uploading=null;this.uploaded.clear();
    // Reloading the extension invalidates ports owned by existing YouTube tabs.
    // Cleanup must still finish even when disconnect() rejects the old context.
    try{this.port?.disconnect();}catch{}finally{this.port=null;}
  }
};
