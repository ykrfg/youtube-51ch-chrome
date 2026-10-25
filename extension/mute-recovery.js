// Per-tab recovery journal: YouTube may persist the mute used to silence its own track.
globalThis.SurroundMuteRecovery=class SurroundMuteRecovery{
  constructor(storage){
    this.storage=storage;this.key='yt-original-surround:mute-recovery';this.pending=null;
    try{const saved=JSON.parse(storage?.getItem(this.key)||'null');
      if(saved&&/^[\w-]{11}$/.test(saved.videoId)&&typeof saved.muted==='boolean')this.pending=saved;
    }catch{}
  }
  remember(videoId,muted){try{this.storage?.setItem(this.key,JSON.stringify({videoId,muted:!!muted}));}catch{}}
  forget(){try{this.storage?.removeItem(this.key);}catch{}}
  recover(videoId,video){
    if(!this.pending)return;
    if(this.pending.videoId!==videoId){this.pending=null;this.forget();return;}
    // Wait until the player has initialized its media element before restoring its preference.
    if(!video||video.readyState<1)return;
    const saved=this.pending;this.pending=null;
    video.muted=saved.muted;this.forget();
  }
};
