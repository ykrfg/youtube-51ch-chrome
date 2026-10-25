const result=document.getElementById('result');
document.getElementById('run').onclick=async()=>{
  let context,worker;
  try{
    context=new AudioContext({sampleRate:48000});await context.resume();
    worker=new Worker('../extension/decoder-worker.js',{type:'module'});
    async function decode(path,trim,duration){
      const bytes=await(await fetch(path)).arrayBuffer();
      const decoded=await new Promise((resolve,reject)=>{
        worker.onmessage=({data})=>data.type==='error'?reject(new Error(data.message)):resolve(data);
        worker.onerror=e=>reject(new Error(e.message));worker.postMessage({bytes,trim,duration},[bytes]);
      });
      const buffer=await context.decodeAudioData(decoded.bytes);
      if(buffer.numberOfChannels!==6)throw new Error('6chが維持されていません。');
      return buffer;
    }
    result.textContent='元の328を区間ごとに変換し、全体デコードとの差を確認しています…';
    const full=await decode('/sample.m4a',0,16.064),first=await decode('/group0.m4a',0,9.984),second=await decode('/group1.m4a',9.984,6.08);
    if(first.length+second.length!==full.length)throw new Error('区間境界でサンプル数が一致しません。');
    let maxError=0;
    for(let ch=0;ch<6;ch++){
      const reference=full.getChannelData(ch),a=first.getChannelData(ch),b=second.getChannelData(ch);
      for(let i=0;i<a.length;i++)maxError=Math.max(maxError,Math.abs(a[i]-reference[i]));
      for(let i=0;i<b.length;i++)maxError=Math.max(maxError,Math.abs(b[i]-reference[a.length+i]));
    }
    if(maxError>1e-5)throw new Error('区間変換のPCMに差があります：'+maxError);
    result.textContent='境界のサンプル一致を確認。25分音声の20分以降の区間を変換しています…';
    const plan=await(await fetch('/long-plan.json')).json(),g=plan.selected;
    const long=await decode('/selected.m4a',g.trim,g.end-g.start);
    if(Math.abs(long.duration-(g.end-g.start))>1/48000)throw new Error('長時間シーク先の区間長が一致しません。');
    result.className='ok';result.textContent=`PASS\n元音声：328 / E-AC-3 → 6ch PCM\n区間1：${first.length} samples、区間2：${second.length} samples\n合計：${first.length+second.length} samples（全体と一致）\n全体デコードとの最大PCM差：${maxError}\n長時間音声：${plan.groups.at(-1).end.toFixed(3)}秒\nシーク先：${g.start.toFixed(3)}〜${g.end.toFixed(3)}秒\n変換結果：${long.numberOfChannels}ch / ${long.sampleRate} Hz / ${long.duration.toFixed(3)}秒\nこの機器の最大出力：${context.destination.maxChannelCount}ch\n※YouTubeへの拡張機能組み込み・物理6スピーカーの確認は別途必要です。`;
  }catch(error){result.className='';result.textContent='FAIL: '+(error.stack||error.message);}
  finally{worker?.terminate();await context?.close();}
};
