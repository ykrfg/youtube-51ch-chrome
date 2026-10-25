// SPDX-License-Identifier: GPL-3.0-or-later
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {root,readJson,sha256} from './files.mjs';
export async function prepareSources(){
 const manifest=await readJson('third_party/ffmpeg-sources.lock.json');const cache=root+'.cache/ffmpeg-sources/';await mkdir(cache,{recursive:true});
 for(const item of manifest.sources){
  if(!/^[a-z0-9.-]+-[a-f0-9]{40}\.zip$/.test(item.file)||!item.url.startsWith('https://codeload.github.com/'))throw new Error('Invalid source manifest entry');
  let bytes;try{bytes=await readFile(cache+item.file);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(bytes&&sha256(bytes)!==item.sha256)throw new Error('Source checksum mismatch: '+item.name+'; remove only this corrupt cache entry and try again.');
  if(!bytes){const response=await fetch(item.url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error('Source download failed: '+item.name+' HTTP '+response.status);bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==item.bytes||sha256(bytes)!==item.sha256)throw new Error('Downloaded source checksum mismatch: '+item.name);await writeFile(cache+item.file,bytes);}
  console.log('Verified source: '+item.name);
 }
 return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await prepareSources();
