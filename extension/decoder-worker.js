import createFFmpegCore from './vendor/ffmpeg-core.js';
let ffmpeg;
self.onmessage = async ({data}) => {
  try {
    ffmpeg ||= await createFFmpegCore({locateFile:path => new URL(`vendor/${path}`, self.location.href).href});
    ffmpeg.setLogger(() => {});
    ffmpeg.FS.writeFile('input.m4a', new Uint8Array(data.bytes));
    ffmpeg.setTimeout(180000);
    const trim=Number(data.trim || 0),duration=Number(data.duration || 0);
    if(!Number.isFinite(trim)||trim<0||!Number.isFinite(duration)||duration<=0||duration>180)throw new Error('変換区間が不正です。');
    ffmpeg.exec('-hide_banner', '-loglevel', 'error', '-y', '-i', 'input.m4a', '-ss', String(trim), '-t', String(duration), '-vn', '-map', '0:a:0', '-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24', '-compression_level', '0', 'output.flac');
    const exitCode=ffmpeg.ret;ffmpeg.reset();
    if (exitCode !== 0) throw new Error('6ch音声のデコードに失敗しました。');
    const bytes = ffmpeg.FS.readFile('output.flac');
    if (String.fromCharCode(...bytes.subarray(0,4)) !== 'fLaC') throw new Error('音声変換の結果が不正です。');
    const channels = ((bytes[20] >> 1) & 7) + 1;
    const sampleRate = (bytes[18]<<12) | (bytes[19]<<4) | (bytes[20]>>4);
    if (channels !== 6) throw new Error(`変換後が${channels}chになったため、切り替えを中止しました。`);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength);
    self.postMessage({type:'decoded', channels, sampleRate, bytes:buffer}, [buffer]);
  } catch (error) { self.postMessage({type:'error', message:String(error.message || error)}); }
  finally {for(const file of ['input.m4a','output.flac']){try{ffmpeg?.FS.unlink(file);}catch{}}}
};
