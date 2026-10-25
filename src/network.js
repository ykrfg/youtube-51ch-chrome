export function transient(error){return error?.name==='TimeoutError'||error?.name==='TypeError'||[408,500,502,503,504].includes(error?.status);}
export function pause(ms,signal){return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(signal.reason);
  const aborted=()=>{clearTimeout(timer);reject(signal.reason);};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',aborted);resolve();},ms);
  signal?.addEventListener('abort',aborted,{once:true});
});}
// A fresh player response can return a media URL that initially rejects the
// request but accepts the identical URL a few seconds later. Limit this grace
// period to the first media initialization probe; API and segment 403s stay fatal.
export async function readInitialMedia(read,{signal,progress=()=>{},delay=pause}={}){
  const waits=[3000,4000];
  for(let attempt=0;;attempt++){
    signal?.throwIfAborted();
    try{return await read();}catch(error){
      if(signal?.aborted)throw signal.reason;
      if(error?.status!==403||attempt>=waits.length)throw error;
      progress('開始直後に403が返ったため、少し待って音声を再確認しています…');
      await delay(waits[attempt],signal);
    }
  }
}
export function createNetwork({fetcher=fetch,signal,progress=()=>{},timeoutMs=30000,delay=pause}={}){
  return async function net(url,options={},consume){
    const u=new URL(url);
    if(u.protocol!=='https:'||!(u.hostname==='www.youtube.com'||u.hostname.endsWith('.googlevideo.com')))throw new Error('対応していない取得先です。');
    const outer=options.signal||signal;
    for(let attempt=0;;attempt++){
      outer?.throwIfAborted();
      const deadline=AbortSignal.timeout(timeoutMs),requestSignal=outer?AbortSignal.any([outer,deadline]):deadline;
      try{
        const response=await fetcher(u.toString(),{...options,credentials:'omit',signal:requestSignal});
        if(!response.ok){const error=new Error(`YouTubeへの接続に失敗しました（HTTP ${response.status}）。`);error.status=response.status;
          try{await response.body?.cancel();}catch{}throw error;}
        return consume?await consume(response):response;
      }catch(cause){
        if(outer?.aborted)throw outer.reason;
        const error=deadline.aborted?Object.assign(new Error('通信が制限時間内に完了しませんでした。'),{name:'TimeoutError'}):cause;
        if(attempt>=1||!transient(error))throw error;
        progress('一時的な通信障害のため、1回だけ再試行しています…');await delay(750,outer);
      }
    }
  };
}
export function describe(error,stage){
  let hint='';
  if(error?.status===403)hint=' 配信元がアクセスを拒否しました。動画や配信側の制限による場合があります。';
  else if(error?.status===429)hint=' 配信元からアクセス頻度を制限されています。時間を置いて再操作してください。';
  const wrapped=new Error(`${stage}：${error?.message||error}${hint}`);
  wrapped.status=error?.status;wrapped.stage=stage;wrapped.name=error?.name||'Error';return wrapped;
}
