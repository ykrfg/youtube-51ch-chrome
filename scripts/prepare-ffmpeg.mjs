// SPDX-License-Identifier: GPL-3.0-or-later
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {root} from './files.mjs';import {prepareSources} from './prepare-sources.mjs';
import {extractSourceArchive} from './extract-sources.mjs';
const manifest=await prepareSources(),destination=root+'.cache/ffmpeg-build/';
async function extract(item,folder){
 await extractSourceArchive(await readFile(root+'.cache/ffmpeg-sources/'+item.file),folder);
}
await mkdir(destination,{recursive:true});
await extract(manifest.sources.find(x=>x.name==='ffmpeg.wasm'),destination);
for(const item of manifest.sources)if(!['ffmpeg.wasm','emscripten','sdl'].includes(item.name))await extract(item,destination+'vendor/'+item.name);
let docker=await readFile(destination+'Dockerfile','utf8');
docker=docker.replace(/^ADD https:\/\/github\.com\/([^\s]+?)\.git#\$\w+ \/src$/gm,(_line,repo)=>{
 const item=manifest.sources.find(x=>x.repository==='https://github.com/'+repo);if(!item)throw new Error('Missing local source: '+repo);return 'COPY vendor/'+item.name+'/ /src/';
}).replace(/^RUN git clone --recursive -b \$ZIMG_BRANCH https:\/\/github\.com\/sekrit-twc\/zimg\.git \/src$/m,'COPY vendor/zimg/ /src/');
if(/^(ADD https:\/\/|RUN git clone)/m.test(docker))throw new Error('An upstream source download was not replaced');
await writeFile(destination+'Dockerfile',docker);
console.log('Prepared '+destination+'\nOn Linux/WSL with Docker 23+ and make: cd to that folder and run make prd.\nThe container image, apt packages and Emscripten SDL port still need network access.');
