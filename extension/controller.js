(() => {
  'use strict';
  if(globalThis.__ytOriginalSurround)return;globalThis.__ytOriginalSurround=true;
  let panel,toggle,status,output,mute,frame,port,context,renderer,metadata,video,modeSelect,reconnect,autoBox;
  let mode='hrtf';
  let autoEnable=false,settingsLoaded=false,settingsTouched=false,autoAttemptedFor='',manualOverrideFor='',needsGesture=false;
  let videoId='',generation=0,opening=false,enabled=false,wantedMuted=false,suppressed=false,requestSequence=0,inflight=null,handshakeTimeout,retryAt=0,lastError='';
  let navigating=false,openingAutomatic=false,openingStartedAt=0,openingProgressAt=0,openingRecoveries=0;
  const cache=new SurroundCache();
  let recoveryStorage;try{recoveryStorage=window.sessionStorage;}catch{}
  const muteRecovery=new SurroundMuteRecovery(recoveryStorage);
  const blockedPrefetch=new Set();let lastGroup=-1,retryFailures=0;
  const id=()=>new URL(location.href).searchParams.get('v')||'';
  const say=text=>{if(status&&status.textContent!==text)status.textContent=text;};
  const ad=()=>!!document.querySelector('#movie_player.ad-showing,#movie_player.ad-interrupting');
  function saveSettings(){try{chrome.storage?.local?.set({autoEnable,mode})?.catch(()=>{});}catch{}}
  function maybeAuto(){
    if(navigating||!settingsLoaded||!autoEnable||autoAttemptedFor===videoId||manualOverrideFor===videoId||opening||metadata||!panel||panel.hidden||ad())return;
    const v=document.querySelector('#movie_player video.html5-main-video');
    if(!v||!Number.isFinite(v.duration)||v.duration<=0)return;
    autoAttemptedFor=videoId;prepare({automatic:true});
  }
  function currentGroup(time){
    let low=0,high=metadata.groups.length-1;
    while(low<=high){const mid=(low+high)>>1,g=metadata.groups[mid];if(time<g.start)high=mid-1;else if(time>=g.end)low=mid+1;else return mid;}
    return time>=metadata.duration?metadata.groups.length-1:0;
  }
  function restore(preserveRecovery=false){
    const wasSuppressed=suppressed;suppressed=false;
    if(video&&wasSuppressed){video.muted=wantedMuted;if(!preserveRecovery)muteRecovery.forget();}
  }
  function off(preserveRecovery=false){
    enabled=false;needsGesture=false;renderer?.stop(true);restore(preserveRecovery);
    if(inflight){port?.postMessage({type:'idle'});inflight=null;}
    if(toggle){toggle.textContent=metadata?'5.1ch：オフ':'5.1chを有効にする';toggle.title='元の5.1ch音声をオンにする';toggle.setAttribute('aria-pressed','false');}
    if(mute)mute.hidden=true;
    if(metadata)say('5.1ch：オフ（YouTube標準音声）。準備済みの区間は保持しています。');
  }
  function clear(preserveRecovery=false){
    generation++;opening=false;clearTimeout(handshakeTimeout);off(preserveRecovery);
    port?.postMessage({type:'cancel'});port?.close();port=null;frame?.remove();frame=null;
    renderer?.dispose();renderer=null;context?.close().catch(()=>{});context=null;
    metadata=null;video=null;cache.clear();blockedPrefetch.clear();lastGroup=-1;retryAt=0;retryFailures=0;lastError='';
    if(toggle){toggle.disabled=false;toggle.textContent='5.1chを有効にする';}
    if(output)output.textContent='';
  }
  function fail(message){clear();say(message);}
  function requestSegment(index){
    if(!port||inflight||cache.has(index)||!metadata.groups[index]||Date.now()<retryAt)return;
    const requestId=++requestSequence;inflight={id:index,requestId};
    port.postMessage({type:'segment',id:index,requestId});
  }
  function tick(){
    if(!enabled||!metadata||!video)return;
    if(!video.isConnected){off();say('プレイヤーが変わりました。もう一度オンにしてください。');return;}
    if(ad()){renderer.stop();restore();say('広告中：YouTube標準音声');return;}
    if(!Number.isFinite(video.duration)||Math.abs(video.duration-metadata.duration)>3){
      renderer.stop();restore();say('映像と音声の長さが一致しないため標準音声で再生しています。');return;
    }
    const index=currentGroup(video.currentTime);
    if(index!==lastGroup){lastGroup=index;blockedPrefetch.clear();retryAt=0;retryFailures=0;lastError='';}
    cache.prune(index);
    if(inflight&&(!cache.has(index)&&inflight.id!==index||Math.abs(inflight.id-index)>2)){
      port.postMessage({type:'idle'});inflight=null;retryAt=0;
    }
    // A seek discards scheduled PCM immediately; buffered native audio remains available while loading.
    const waiting=video.paused||video.ended||video.seeking||video.readyState<3;
    if(waiting){renderer.stop();restore();}
    else if(renderer.render(video.currentTime,video.playbackRate,index,metadata.groups,cache,video.volume,wantedMuted)){
      if(suppressed&&!video.muted)wantedMuted=false;
      if(!suppressed||!video.muted)muteRecovery.remember(videoId,wantedMuted);
      suppressed=true;if(!video.muted)video.muted=true;
      const label=mode==='hrtf'?'HRTF':mode==='atmos'?'Windows空間音響':'6ch PCM';
      say(`5.1ch：オン ／ ${label} ／ ${metadata.formatId}・6ch ／ 区間 ${index+1}/${metadata.groups.length}`);
    }else{restore();say(renderer.status?.()||lastError||'5.1ch：区間を準備中（YouTube標準音声で再生中）');}
    if(!cache.has(index)){requestSegment(index);return;}
    if(waiting)say(mode==='atmos'&&!renderer.available?renderer.status():'5.1ch：オン（停止中・シーク待機中）');
    // Two bounded forward buffers are enough to schedule seamless boundaries without storing the full track.
    if(!video.seeking)for(let next=index+1;next<Math.min(metadata.groups.length,index+3);next++){
      if(!cache.has(next)){if(!blockedPrefetch.has(next))requestSegment(next);break;}
    }
  }
  function setupRenderer(){
    renderer?.dispose();restore();
    if(reconnect)reconnect.hidden=mode!=='atmos';
    if(mode==='hrtf')output.textContent='HRTFヘッドホン：元の6chを仮想配置して2chへ。Dolby等の追加空間処理はオフにして比較してください。';
    else if(mode==='atmos')output.textContent='Windows空間音響：元の6chを出力します。Windows側でDolby Atmos for Headphones・DTS Headphone:X・Windows Sonicを選択してください。';
    else output.textContent='6chスピーカー：ブラウザが対応するチャンネル数で出力します。';
    // Open the OS output only after a supported six-channel stream is confirmed.
    if(!context||!metadata)return;
    const max=context.destination.maxChannelCount||2;
    context.destination.channelCount=mode==='direct'?Math.min(6,max):Math.min(2,max);
    context.destination.channelCountMode='explicit';context.destination.channelInterpretation='speakers';
    renderer=mode==='atmos'?new AtmosRenderer():new SurroundRenderer(context,{mode});
    if(mode==='direct')output.textContent=context.destination.channelCount>=6?'出力：6ch PCM ／ 周辺3区間のみ保持':`出力：${context.destination.channelCount}ch（元の6ch音声を通常ダウンミックス）`;
  }
  async function changeMode(){
    settingsTouched=true;mode=modeSelect.value;saveSettings();
    try{setupRenderer();if(context&&enabled){await context.resume();tick();}}
    catch(error){off();say(error.message);}
  }
  function bindVideo(next){
    if(video===next)return;
    restore();muteRecovery.recover(videoId,next);video=next;wantedMuted=video.muted;
    for(const name of ['play','pause','playing','waiting','seeking','seeked','ratechange','volumechange','ended']){
      video.addEventListener(name,()=>{if(next===video){
        if(name==='volumechange'&&!suppressed)wantedMuted=video.muted;
        if(['seeking','pause','waiting','ratechange','ended'].includes(name))renderer?.stop();
        if(name==='seeking'){retryAt=0;lastError='';}
        tick();
      }});
    }
  }
  async function enable({automatic=false}={}){
    const next=document.querySelector('#movie_player video.html5-main-video');if(!next)return;
    bindVideo(next);
    if(!suppressed)wantedMuted=next.muted;
    if(ad())return say('広告終了後に5.1chをオンにしてください。');
    const mine=generation;
    try{
      if(automatic){
        if(mode!=='atmos'&&context.state!=='running'){
          needsGesture=true;enabled=false;toggle.textContent='クリックして5.1chを有効にする';toggle.setAttribute('aria-pressed','false');
          say('元の6ch音声を確認しました。ブラウザの制限解除のため、ボタンまたは動画の再生操作が必要です。');return;
        }
      }else await context.resume();
      if(mine!==generation)return;needsGesture=false;enabled=true;lastError='';retryAt=0;
      toggle.textContent='5.1ch：オン';toggle.title='元の5.1ch音声をオフにする';toggle.setAttribute('aria-pressed','true');mute.hidden=false;
      mute.textContent=wantedMuted?'5.1chのミュート解除':'5.1chをミュート';tick();
    }catch(error){if(mine===generation)fail(error.message);}
  }
  async function prepare({automatic=false,recovering=false}={}){
    if(navigating)return;
    clear();const mine=generation;
    if(!/^[\w-]{11}$/.test(id()))return;
    if(!recovering){openingStartedAt=Date.now();openingRecoveries=0;}
    openingAutomatic=automatic;openingProgressAt=Date.now();
    opening=true;toggle.textContent='準備をキャンセル';say('元の6ch音声の区間索引を確認しています…');
    try{
      context=new AudioContext({sampleRate:48000});const activeContext=context;
      context.addEventListener('statechange',()=>{
        if(context===activeContext&&mine===generation&&needsGesture&&autoEnable&&manualOverrideFor!==videoId&&context.state==='running')enable({automatic:true});
      });
      if(automatic)context.resume().catch(()=>{});else await context.resume();
      if(mine!==generation)return;
      setupRenderer();
      frame=document.createElement('iframe');frame.hidden=true;frame.src=chrome.runtime.getURL('processor.html');
      frame.addEventListener('load',()=>{
        if(mine!==generation)return;
        const channel=new MessageChannel();port=channel.port1;
        port.onmessage=async({data})=>{
          if(mine!==generation)return;
          if(!['progress','error','opened','segment'].includes(data.type))return;
          clearTimeout(handshakeTimeout);openingProgressAt=Date.now();
          if(data.type==='progress')say(data.message);
          if(data.type==='error'){
            if(!metadata)return fail(automatic&&data.message.includes('取得可能な元の6ch音声がありません')?'YouTube標準音声：この動画には取得可能な元の6ch音声がありません。':data.message);
            if(data.requestId!==inflight?.requestId)return;
            inflight=null;
            if(data.fatal||++retryFailures>=3){off();say(`5.1chを停止し標準音声に戻しました：${data.message} 再試行する場合は時間を置いてオンにしてください。`);return;}
            const delay=5000*2**(retryFailures-1);retryAt=Date.now()+delay;lastError=`区間を取得できません：${data.message}（標準音声へ切り替え。${delay/1000}秒後に再試行）`;tick();return;
          }
          if(data.type==='opened'){
            if(!Array.isArray(data.groups)||!data.groups.length||data.channels!==6)return fail('6ch音声の区間索引が不正です。');
            metadata=data;opening=false;setupRenderer();await enable({automatic});return;
          }
          if(data.type!=='segment'||data.requestId!==inflight?.requestId)return;
          const pending=inflight;
          try{
            if(!(data.bytes instanceof ArrayBuffer)||data.channels!==6)throw new Error('音声区間が6chではありません。');
            const buffer=await context.decodeAudioData(data.bytes);
            if(mine!==generation||inflight?.requestId!==pending.requestId)return;
            const group=metadata.groups[data.id];
            if(buffer.numberOfChannels!==6||Math.abs(buffer.duration-(group.end-group.start))>0.08)throw new Error('音声区間の長さまたはチャンネル数が一致しません。');
            if(!cache.put(data.id,buffer,currentGroup(video.currentTime)))blockedPrefetch.add(data.id);
            inflight=null;retryAt=0;retryFailures=0;lastError='';tick();
          }catch(error){if(mine===generation&&inflight?.requestId===pending.requestId){
            inflight=null;
            if(++retryFailures>=3){off();say(`音声区間の処理に繰り返し失敗したため標準音声に戻しました：${error.message}`);return;}
            retryAt=error.message.includes('キャッシュ上限')?Infinity:Date.now()+5000*2**(retryFailures-1);lastError=error.message;tick();
          }}
        };
        port.start();frame.contentWindow.postMessage({type:'bind-surround'},chrome.runtime.getURL('').replace(/\/$/,''),[channel.port2]);
        port.postMessage({type:'open',videoId});
      },{once:true});
      document.body.append(frame);
      handshakeTimeout=setTimeout(()=>{if(mine===generation)fail('音声処理フレームを起動できません。拡張機能とページを再読み込みしてください。');},20000);
    }catch(error){if(mine===generation)fail(error.message);}
  }
  function checkOpening(){
    if(!opening)return;
    const expired=Date.now()-openingStartedAt>=105000;
    const missing=frame&&!frame.isConnected;
    const stalled=port&&Date.now()-openingProgressAt>=35000;
    if(!expired&&!missing&&!stalled)return;
    if(!expired&&openingRecoveries<1){
      openingRecoveries++;
      prepare({automatic:openingAutomatic,recovering:true});
      say('動画切り替え後の音声準備を1回だけやり直しています…');
    }else fail('音声の準備が進まないため標準音声に戻しました。5.1chボタンで再試行できます。');
  }
  function mount(){
    if(navigating)return;
    const next=id();if(next!==videoId){clear();videoId=next;autoAttemptedFor='';manualOverrideFor='';say('元の5.1ch音声と標準音声を切り替えます。');}
    const player=document.querySelector('#movie_player');
    if(!player||!/^[\w-]{11}$/.test(next)||location.pathname!=='/watch'){
      if(panel)panel.hidden=true;if(enabled||opening||metadata)clear();return;
    }
    if(!panel){
      panel=document.createElement('section');panel.id='yt-original-surround';panel.setAttribute('aria-label','YouTube Original 5.1');
      const modeLabel=document.createElement('label');modeLabel.textContent='再生モード：';
      modeSelect=document.createElement('select');modeSelect.setAttribute('aria-label','再生モード');
      for(const [value,label] of [['hrtf','HRTFヘッドホン'],['atmos','Windows空間音響（Dolby／DTS）'],['direct','6chスピーカー／通常ミックス']]){
        const option=document.createElement('option');option.value=value;option.textContent=label;modeSelect.append(option);
      }
      modeSelect.value=mode;modeSelect.addEventListener('change',changeMode);modeLabel.append(modeSelect);
      reconnect=document.createElement('button');reconnect.textContent='Windows空間音響に再接続';reconnect.hidden=true;reconnect.addEventListener('click',changeMode);
      toggle=document.createElement('button');toggle.textContent='5.1chを有効にする';toggle.setAttribute('aria-pressed','false');
      toggle.addEventListener('click',()=>{settingsTouched=true;manualOverrideFor=videoId;if(opening){clear();say('準備をキャンセルしました。');}else if(enabled)off();else if(metadata)enable();else prepare();});
      mute=document.createElement('button');mute.hidden=true;mute.addEventListener('click',()=>{wantedMuted=!wantedMuted;if(suppressed)muteRecovery.remember(videoId,wantedMuted);if(video&&!suppressed)video.muted=wantedMuted;mute.textContent=wantedMuted?'5.1chのミュート解除':'5.1chをミュート';tick();});
      status=document.createElement('span');status.dataset.role='status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='元の5.1ch音声と標準音声を切り替えます。';
      const autoLabel=document.createElement('label');autoBox=document.createElement('input');autoBox.type='checkbox';autoBox.checked=autoEnable;
      autoLabel.append(autoBox,document.createTextNode('対応動画では自動で5.1chを有効にする'));
      autoBox.addEventListener('change',()=>{
        settingsTouched=true;autoEnable=autoBox.checked;saveSettings();
        if(autoEnable){autoAttemptedFor='';manualOverrideFor='';maybeAuto();}
      });
      const help=document.createElement('span');help.dataset.role='help';help.textContent='「取得中」の表示で止まった場合は、5.1chを一度オフにしてからオンにし直してください（準備中は「準備をキャンセル」→「5.1chを有効にする」）。';
      output=document.createElement('span');output.dataset.role='output';panel.append(modeLabel,toggle,mute,reconnect,autoLabel,status,output,help);setupRenderer();
    }
    panel.hidden=false;const below=document.querySelector('#below');
    muteRecovery.recover(videoId,document.querySelector('#movie_player video.html5-main-video'));
    if(below&&panel.parentElement!==below)below.prepend(panel);else if(!panel.isConnected)player.parentElement.append(panel);
    checkOpening();maybeAuto();
  }
  document.addEventListener('yt-navigate-start',()=>{navigating=true;clear();if(panel)panel.hidden=true;});
  document.addEventListener('yt-navigate-finish',()=>{navigating=false;mount();});
  window.addEventListener('pagehide',()=>{if(suppressed)muteRecovery.remember(videoId,wantedMuted);clear(true);});
  setInterval(mount,1000);setInterval(tick,80);mount();
  (async()=>{
    try{
      const saved=await chrome.storage?.local?.get({autoEnable:false,mode:'hrtf'});
      if(saved&&!settingsTouched){autoEnable=!!saved.autoEnable;if(['hrtf','atmos','direct'].includes(saved.mode))mode=saved.mode;
        if(autoBox)autoBox.checked=autoEnable;if(modeSelect)modeSelect.value=mode;if(output&&!context)setupRenderer();}
    }catch{}
    settingsLoaded=true;maybeAuto();
  })();
})();
