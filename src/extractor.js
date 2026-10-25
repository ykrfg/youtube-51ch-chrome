import {Player, Platform, Log} from 'youtubei.js/web';
import {parseSidx,makeGroups} from './dash.js';
import {createNetwork,describe,readInitialMedia} from './network.js';
Log.setLevel(Log.Level.ERROR);
export const TV_VERSION = '5.20260707';
export const TV_AGENT = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1';
export function candidates(formats) {
  const rank = f => f.itag === 328 ? 0 : f.itag === 380 ? 1 : 2;
  return formats.filter(f => f.audioChannels === 6 && /^audio\/mp4/.test(f.mimeType || '') && !f.drmFamilies && f.initRange && f.indexRange && Number(f.contentLength)>0)
    .sort((a,b) => rank(a)-rank(b));
}
export async function openStream(videoId, {evaluate, fetcher = fetch, signal, progress = () => {}} = {}) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('動画IDが不正です。');
  const net=createNetwork({fetcher,signal,progress});
  const stage=async(label,fn)=>{try{return await fn();}catch(error){if(signal?.aborted)throw signal.reason;throw describe(error,label);}};
  Platform.load({fetch:net, eval:evaluate, runtime:'browser', server:false});
  progress('YouTubeの音声形式を確認しています…');
  const html = await stage('動画情報の取得',()=>net(`https://www.youtube.com/watch?v=${videoId}&hl=en`,{},r=>r.text()));
  const visitor = html.match(/"VISITOR_DATA"\s*:\s*"([^"]+)"/)?.[1];
  if (!visitor) throw new Error('YouTubeの閲覧者情報を取得できません。公開動画で試してください。');
  const player = await stage('プレイヤー解析',()=>Player.create(undefined, net));
  if (!player.signature_timestamp) throw new Error('YouTubeプレイヤーの解析に失敗しました。拡張機能の更新が必要な可能性があります。');
  const response = await stage('音声形式の取得',()=>net('https://www.youtube.com/youtubei/v1/player?prettyPrint=false&ys51=1', {
    method:'POST', headers:{'Content-Type':'application/json', 'X-YouTube-Client-Name':'7', 'X-YouTube-Client-Version':TV_VERSION, 'X-Goog-Visitor-Id':visitor},
    body:JSON.stringify({videoId, contentCheckOk:true, racyCheckOk:true,
      context:{client:{clientName:'TVHTML5', clientVersion:TV_VERSION, deviceMake:'Samsung', deviceModel:'UKS9800', userAgent:TV_AGENT, osName:'Tizen', osVersion:'2.4.0', hl:'en', timeZone:'UTC', utcOffsetMinutes:0}},
      playbackContext:{contentPlaybackContext:{html5Preference:'HTML5_PREF_WANTS', signatureTimestamp:player.signature_timestamp}}})
  },r=>r.json()));
  if (response.playabilityStatus?.status !== 'OK') throw new Error(`YouTubeが音声取得を許可しませんでした：${response.playabilityStatus?.reason || response.playabilityStatus?.status || '不明'}`);
  const formats = candidates(response.streamingData?.adaptiveFormats || []);
  if (!formats.length) throw new Error('取得可能な元の6ch音声がありません。アップミックスは行いません。');
  let last,firstInitialization=true;
  for (const f of formats) {
    try {
      progress(`元の${f.itag} / 6ch音声の配信URLを解析しています…`);
      const address = new URL(await stage('配信URLの解析',()=>player.decipher(f.url, f.signatureCipher, f.cipher)));
      address.searchParams.set('cver', TV_VERSION);
      const size=Number(f.contentLength);
      const read=async (start,end,readSignal) => {
        const length=end-start+1;
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>=size||length<=0||length>40*1024*1024)throw new Error('音声の取得範囲が不正です。');
        const url=new URL(address);url.searchParams.set('range',`${start}-${end}`);
        return net(url.toString(),{signal:readSignal},async media=>{
        const reader=media.body.getReader(),parts=[];let total=0;
        for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;
          if(total>length){await reader.cancel();throw new Error('配信元が区間指定に対応しないため、全体取得を中止しました。');}parts.push(value);}
        if(total!==length)throw new Error('音声区間を最後まで取得できませんでした。');
        const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return bytes;
        });
      };
      const initStart=Number(f.initRange.start),initEnd=Number(f.initRange.end),indexStart=Number(f.indexRange.start),indexEnd=Number(f.indexRange.end);
      if(initEnd-initStart>1024*1024||indexEnd-indexStart>4*1024*1024)throw new Error('音声の初期化領域または索引が大きすぎます。');
      progress(`元の${f.itag} / 6ch音声の初期化領域を取得しています…`);
      const init=await stage(`音声${f.itag}の初期化領域取得`,()=>{
        const probe=()=>read(initStart,initEnd,signal);
        if(!firstInitialization)return probe();
        firstInitialization=false;
        return readInitialMedia(probe,{signal,progress});
      });
      progress(`元の${f.itag} / 6ch音声の区間索引を取得しています…`);
      const index=await stage(`音声${f.itag}の索引取得`,()=>read(indexStart,indexEnd,signal));
      const groups=makeGroups(parseSidx(index,indexStart,size));
      const fingerprint=JSON.stringify([f.itag,size,initStart,initEnd,indexStart,indexEnd,groups]);
      return {formatId:f.itag,codec:f.mimeType,channels:6,sampleRate:Number(f.audioSampleRate),duration:groups.at(-1).end,groups,fingerprint,
        async readGroup(id,readSignal){
          const group=groups[id];if(!group)throw new Error('音声区間が見つかりません。');
          let fragment;try{fragment=await read(group.byteStart,group.byteEnd,readSignal);}catch(error){throw describe(error,`音声${f.itag}の区間${id+1}取得`);}
          const bytes=new Uint8Array(init.length+fragment.length);bytes.set(init);bytes.set(fragment,init.length);
          return {bytes,trim:group.trim,duration:group.end-group.start};
        }};
    } catch (error) { if (signal?.aborted) throw error; last = error; }
  }
  throw last || new Error('6ch音声を取得できませんでした。');
}
