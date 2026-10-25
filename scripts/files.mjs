// SPDX-License-Identifier: GPL-3.0-or-later
import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const root=fileURLToPath(new URL('../',import.meta.url));
export const sha256=data=>createHash('sha256').update(data).digest('hex');
export const readJson=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const rootFiles=['README.md','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','TEST_RESULTS.md','CHANGELOG.md','package.json','package-lock.json','build-date.json','build.mjs','.gitignore','.gitattributes'];
const directories=['src','extension','native','tests','scripts','docs','licenses','third_party','.github'];
export function generated(path){return path==='extension/processor.js'||path.startsWith('extension/vendor/')||path.startsWith('extension/_metadata/')||['native/youtube-surround-host.exe','native/jp.local.youtube_surround_audio.json','native/build-info.json'].includes(path)||/\.(obj|pdb|ilk|log)$/i.test(path);}
async function directoryFiles(dir){
 const paths=[];
 for(const entry of await readdir(new URL('../'+dir+'/',import.meta.url),{withFileTypes:true})){const path=dir+'/'+entry.name;if(entry.isDirectory())paths.push(...await directoryFiles(path));else if(entry.isFile())paths.push(path);}
 return paths;
}
export async function projectFiles(){
 const paths=[...rootFiles];
 for(const dir of directories)paths.push(...(await directoryFiles(dir)).filter(path=>!generated(path)));
 return paths.sort();
}
export async function runtimeFiles(){
 const extension=['manifest.json','content.css','controller.js','segmented-audio.js','atmos-renderer.js','mute-recovery.js','native-bridge.js','processor.html','processor.js','decoder-worker.js','solver.html','solver.js','rules.json','vendor/ffmpeg-core.js','vendor/ffmpeg-core.wasm'];
 return ['LICENSE','NOTICE','THIRD_PARTY_NOTICES.md',...extension.map(file=>'extension/'+file),...['youtube-surround-host.exe','extension-id.txt','Install.cmd','Uninstall.cmd'].map(file=>'native/'+file),...await directoryFiles('licenses')].sort();
}
export function runtimeReadme(readme){
 return readme.replaceAll('\r\n','\n').replace(/## 開発・配布\n[\s\S]*?(?=## ライセンス)/,'## ソースコード\n\nソースコードと対応ソースは別配布です。[SOURCE.md](SOURCE.md) を参照してください。\n\n')
  .replace('検証内容と確認範囲は [検証記録](TEST_RESULTS.md) を参照してください。','検証内容と確認範囲は、ソース配布物のTEST_RESULTS.mdを参照してください。');
}
export async function nativeSourceHashes(){const hashes={};for(const path of ['native/host.cpp','native/vendor/json.hpp','native/build.cmd'])hashes[path]=sha256(await readFile(new URL('../'+path,import.meta.url)));return hashes;}
