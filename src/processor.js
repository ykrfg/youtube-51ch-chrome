import {openStream} from './extractor.js';
const solver = document.getElementById('solver');
let sequence = 0;
const pending = new Map();
// The handshake is initiated by solver load, avoiding opaque-origin DOM access.
const ready = new Promise(resolve => {
  solver.addEventListener('load', () => {
    const channel = new MessageChannel();
    channel.port1.onmessage = ({data}) => {
      const job = pending.get(data.id); if (!job) return;
      pending.delete(data.id); clearTimeout(job.timeout);
      data.error ? job.reject(new Error(data.error)) : job.resolve(data.value);
    };
    solver.contentWindow.postMessage({type:'bind-solver'}, '*', [channel.port2]);
    resolve(channel.port1);
  }, {once:true});
  solver.src = 'solver.html';
});
async function evaluate(data,signal) {
  signal?.throwIfAborted();
  let timer,port;
  let abortReady;
  try{port=await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('URL解析フレームの接続がタイムアウトしました。')),10000);abortReady=()=>reject(signal.reason);signal?.addEventListener('abort',abortReady,{once:true});})]);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abortReady);}
  signal?.throwIfAborted();
  const id = ++sequence;
  return new Promise((resolve,reject) => {
    const finish=(error,value)=>{clearTimeout(timeout);pending.delete(id);signal?.removeEventListener('abort',aborted);error?reject(error):resolve(value);};
    const aborted=()=>finish(signal.reason);
    const timeout = setTimeout(() => finish(new Error('YouTubeのURL解析がタイムアウトしました。')), 15000);
    pending.set(id,{resolve:value=>finish(null,value),reject:error=>finish(error),timeout});signal?.addEventListener('abort',aborted,{once:true});port.postMessage({id,code:data.output});
  });
}
function bindProcessor(event) {
  if (event.source !== parent || event.origin !== 'https://www.youtube.com' || event.data?.type !== 'bind-surround' || !event.ports[0]) return;
  window.removeEventListener('message', bindProcessor);
  const port = event.ports[0];
  let sessionAbort,jobAbort,decoder,rejectDecode,stream,videoId,generation=0,closed=false;
  const send = (data, transfer = []) => {if(!closed)port.postMessage(data, transfer);};
  function cancelJob(){
    const decoding=!!rejectDecode;
    generation++;jobAbort?.abort();jobAbort=null;
    if(rejectDecode){rejectDecode(new DOMException('Cancelled','AbortError'));rejectDecode=null;}
    if(decoding){decoder?.terminate();decoder=null;}
  }
  function dispose(){if(closed)return;closed=true;cancelJob();sessionAbort?.abort();decoder?.terminate();decoder=null;stream=null;port.close?.();}
  window.addEventListener('pagehide',dispose,{once:true});
  async function decode(data){
    decoder ||= new Worker(new URL('decoder-worker.js',location.href),{type:'module'});
    const worker=decoder;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{worker.terminate();if(decoder===worker)decoder=null;finish(new Error('音声区間の変換がタイムアウトしました。'));},60000);
      function finish(error,value){clearTimeout(timeout);rejectDecode=null;error?reject(error):resolve(value);}
      rejectDecode=error=>finish(error);
      worker.onmessage=({data})=>data.type==='error'?finish(new Error(data.message)):finish(null,data);
      worker.onerror=()=>{if(decoder===worker)decoder=null;worker.terminate();finish(new Error('音声変換を起動できません。'));};
      worker.postMessage(data,[data.bytes]);
    });
  }
  port.onmessage = async ({data}) => {
    if(closed||!['open','segment','idle','cancel'].includes(data.type))return;
    cancelJob();const mine=generation;
    if(data.type==='cancel'){dispose();return;}
    if(data.type==='idle')return;
    if(data.type==='open'){
      sessionAbort?.abort();sessionAbort=new AbortController();videoId=data.videoId;stream=null;
      const openingSignal=AbortSignal.any([sessionAbort.signal,AbortSignal.timeout(90000)]);
      try{
        const opened=await openStream(videoId,{evaluate:data=>evaluate(data,openingSignal),signal:openingSignal,progress:message=>{if(mine===generation)send({type:'progress',message});}});
        if(mine!==generation)return;stream=opened;
        send({type:'opened',formatId:stream.formatId,codec:stream.codec,channels:6,sampleRate:stream.sampleRate,duration:stream.duration,
          groups:stream.groups.map(({id,start,end})=>({id,start,end}))});
      }catch(error){if(mine===generation)send({type:'error',status:error.status,message:openingSignal.aborted&&!sessionAbort.signal.aborted?'音声の初期化が90秒以内に完了しませんでした。標準音声を使用します。':String(error.message||error)});}
      return;
    }
    if(!stream)return send({type:'error',requestId:data.requestId,message:'音声の初期化が完了していません。'});
    jobAbort=new AbortController();
    const signal=AbortSignal.any([sessionAbort.signal,jobAbort.signal]);
    try {
      let input;
      try{input=await stream.readGroup(data.id,signal);}
      catch(error){
        if(![403,410].includes(error.status))throw error;
        send({type:'progress',message:'音声の配信URLを1回だけ更新しています…'});
        const refreshSignal=AbortSignal.any([signal,AbortSignal.timeout(90000)]);
        const refreshed=await openStream(videoId,{evaluate:data=>evaluate(data,refreshSignal),signal:refreshSignal});
        if(refreshed.fingerprint!==stream.fingerprint)throw new Error('配信音声の索引が変更されました。5.1chを初期化し直してください。');
        stream=refreshed;input=await stream.readGroup(data.id,signal);
      }
      if(mine!==generation)return;
      const decoded=await decode({bytes:input.bytes.buffer,trim:input.trim,duration:input.duration});
      if(mine!==generation)return;
      if(decoded.bytes.byteLength>128*1024*1024)throw new Error('音声区間の変換結果が大きすぎます。');
      send({type:'segment',id:data.id,requestId:data.requestId,channels:decoded.channels,sampleRate:decoded.sampleRate,bytes:decoded.bytes},[decoded.bytes]);
    } catch (error) {
      if(mine===generation)send({type:'error',id:data.id,requestId:data.requestId,status:error.status,fatal:[403,410,429].includes(error.status),message:String(error.message||error)});
    }
  };
  port.start();
}
window.addEventListener('message', bindProcessor);
