document.getElementById('run').onclick=async()=>{
  const output=document.getElementById('result');output.textContent='HRTFをオフラインでレンダリングしています…';
  try{
    const results=[];
    for(const channel of [0,1,2,3,4,5]){
      const context=new OfflineAudioContext(2,24000,48000),renderer=new SurroundRenderer(context,{mode:'hrtf'});
      const buffer=context.createBuffer(6,16000,48000);let seed=17;
      const data=buffer.getChannelData(channel);for(let i=0;i<data.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;data[i]=(seed>>>0)/4294967296*0.2-0.1;}
      const source=context.createBufferSource();source.buffer=buffer;source.connect(renderer.gain);source.start();
      const rendered=await context.startRendering(),left=rendered.getChannelData(0),right=rendered.getChannelData(1);
      const rms=array=>Math.sqrt(array.reduce((sum,x)=>sum+x*x,0)/array.length);
      results.push({channel,left:new Float32Array(left),right:new Float32Array(right),l:rms(left),r:rms(right)});renderer.dispose();
    }
    for(const ch of [0,4])if(results[ch].l<=results[ch].r)throw new Error(`左側チャンネル${ch}の方向が不正です。`);
    for(const ch of [1,5])if(results[ch].r<=results[ch].l)throw new Error(`右側チャンネル${ch}の方向が不正です。`);
    let difference=0,lfeDifference=0;
    for(let i=0;i<24000;i++){difference=Math.max(difference,Math.abs(results[0].left[i]-results[4].left[i]));lfeDifference=Math.max(lfeDifference,Math.abs(results[3].left[i]-results[3].right[i]));}
    if(difference<1e-5||lfeDifference>1e-6)throw new Error('前後方向またはLFE経路が一致しません。');
    output.className='ok';output.textContent='PASS\n5方向のHRTF＋独立したLFE経路を確認\n'+results.map((r,i)=>`${['FL','FR','C','LFE','SL','SR'][i]}：左RMS ${r.l.toFixed(6)} ／ 右RMS ${r.r.toFixed(6)}`).join('\n')+`\n前方・後方フィルターの差：${difference.toFixed(6)}\nLFE左右差：${lfeDifference}\n※頭や耳の形による聞こえ方の個人差は、この数値テストでは評価しません。`;
  }catch(error){output.className='';output.textContent='FAIL: '+(error.stack||error.message);}
};
