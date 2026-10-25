// Only a top-frame YouTube content script can reach the PCM-only native host.
chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=='atmos-output'||port.sender?.frameId!==0||!port.sender?.tab)return;
  try{if(new URL(port.sender.url).origin!=='https://www.youtube.com')return;}catch{return;}
  let native;
  const reply=data=>{try{port.postMessage(data);}catch{native?.disconnect();}};
  try{
    native=chrome.runtime.connectNative('jp.local.youtube_surround_audio');
    native.onMessage.addListener(reply);
    native.onDisconnect.addListener(()=>{
      const error=chrome.runtime.lastError;
      reply({type:'disconnected',message:error?.message||'Native audio host stopped'});native=null;
    });
    native.postMessage({type:'init'});
  }catch(error){reply({type:'disconnected',message:error.message});}
  const allowed=new Set(['state','pause','retain','begin','chunk','commit','abort']);
  port.onMessage.addListener(data=>{
    if(!native||!data||!allowed.has(data.type))return;
    try{native.postMessage(data);}catch(error){reply({type:'error',message:error.message});}
  });
  port.onDisconnect.addListener(()=>{native?.disconnect();native=null;});
});
