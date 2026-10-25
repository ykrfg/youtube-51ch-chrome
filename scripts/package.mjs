// SPDX-License-Identifier: GPL-3.0-or-later
import {zipSync} from 'fflate';import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {root,readJson,sha256,projectFiles,runtimeFiles,runtimeReadme,nativeSourceHashes} from './files.mjs';
import {prepareSources} from './prepare-sources.mjs';
import {buildIdentity} from './build-date.mjs';
const pkg=await readJson('package.json'),manifest=await readJson('extension/manifest.json');
const dateConfig=await readJson('build-date.json'),identity=buildIdentity(dateConfig.date,dateConfig.revision);
if(pkg.version!==identity.packageVersion||manifest.version!==identity.extensionVersion||manifest.version_name!==identity.label||pkg.license!=='GPL-3.0-or-later')throw new Error('Build date or license metadata mismatch');
const id=sha256(Buffer.from(manifest.key,'base64')).slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
if(id!==(await readFile(root+'native/extension-id.txt','utf8')).trim())throw new Error('Extension/native host ID mismatch');
const native=await readJson('native/build-info.json');
if(JSON.stringify(native.sources)!==JSON.stringify(await nativeSourceHashes())||native.binarySha256!==sha256(await readFile(root+'native/youtube-surround-host.exe')))throw new Error('Native host is stale; run npm run build:native');
for(const file of ['ffmpeg-core.js','ffmpeg-core.wasm'])if(sha256(await readFile(root+'extension/vendor/'+file))!==sha256(await readFile(root+'node_modules/@ffmpeg/core/dist/esm/'+file)))throw new Error('FFmpeg vendor mismatch; run npm run build');
const browser=await readJson('.cache/browser-build.json');
if(JSON.stringify(browser.build)!==JSON.stringify(identity))throw new Error('Build date changed; run npm run build');
for(const [path,hash] of Object.entries(browser.inputs))if(sha256(await readFile(root+path))!==hash)throw new Error('Browser source is stale; run npm run build');
if(browser.outputSha256!==sha256(await readFile(root+'extension/processor.js')))throw new Error('Browser bundle is stale; run npm run build');
const sources=await prepareSources(),dist=root+'dist/'+identity.label+'/',prefix='youtube-original-5.1-'+identity.label;
await mkdir(dist+'release/',{recursive:true});await mkdir(dist+'source/',{recursive:true});
const [buildYear,buildMonth,buildDay]=identity.date.split('-').map(Number);
const options={level:6,mtime:new Date(buildYear,buildMonth-1,buildDay)};
async function archiveEntries(files,folder='youtube-original-5.1'){const entries={};for(const file of files)entries[folder+'/'+file]=await readFile(root+file);return entries;}
const encode=text=>new TextEncoder().encode(text);
const sourceZip=zipSync(await archiveEntries(await projectFiles(),'youtube-original-5.1-source'),options);
const runtimeEntries=await archiveEntries(await runtimeFiles());
runtimeEntries['youtube-original-5.1/README.md']=encode(runtimeReadme(await readFile(root+'README.md','utf8')));
runtimeEntries['youtube-original-5.1/SOURCE.md']=encode('# ソースコードとライセンス\n\nビルド日：'+identity.label+'\n\nこのZIPには実行に必要なファイルと導入説明・ライセンスを収録しています。開発用ソースは次の別配布ファイルにあります。同じGitHub Releaseから取得できます。\n\n- `'+prefix+'-source.zip`：本体ソース、テスト、ビルド手順。\n- `'+prefix+'-corresponding-source.zip`：本体とFFmpeg等の対応ソース。\n\n本体のライセンスはGPL-3.0-or-laterです。第三者のライセンス表示はTHIRD_PARTY_NOTICES.mdとlicenses/を参照してください。\n');
runtimeEntries['youtube-original-5.1/THIRD_PARTY_NOTICES.md']=encode((await readFile(root+'THIRD_PARTY_NOTICES.md','utf8')).replace('[docs/BUILDING.md](docs/BUILDING.md) と [docs/RELEASING.md](docs/RELEASING.md)','別配布ソース内のdocs/BUILDING.mdとdocs/RELEASING.md（[ソースの入手方法](SOURCE.md)）'));
const runtimeZip=zipSync(runtimeEntries,options);
const sourceEntries={'project-sources.zip':[sourceZip,{level:0}],'ffmpeg-sources.lock.json':await readFile(root+'third_party/ffmpeg-sources.lock.json'),'BUILDING.md':await readFile(root+'docs/BUILDING.md'),'LICENSE':await readFile(root+'LICENSE'),'THIRD_PARTY_NOTICES.md':await readFile(root+'THIRD_PARTY_NOTICES.md')};
for(const item of sources.sources)sourceEntries['upstream/'+item.file]=[await readFile(root+'.cache/ffmpeg-sources/'+item.file),{level:0}];
const artifacts={['source/'+prefix+'-source.zip']:sourceZip,['release/'+prefix+'-windows-x64.zip']:runtimeZip,['source/'+prefix+'-corresponding-source.zip']:zipSync(sourceEntries,options)};
const hashes={};for(const [name,bytes] of Object.entries(artifacts)){await writeFile(dist+name,bytes);hashes[name]=sha256(bytes);}
const info={buildDate:identity.date,buildRevision:identity.revision,buildLabel:identity.label,extensionVersion:identity.extensionVersion,license:pkg.license,node:process.versions.node,extensionId:id,artifacts:hashes,ffmpeg:{version:sources.coreVersion,upstreamCommit:sources.upstreamCommit,sourceArchives:sources.sources.length},nativeHost:{binarySha256:native.binarySha256,selfTest:native.selfTest},notes:['The native executable is unsigned.','Exact byte-for-byte reproduction across different compiler/SDK/toolchain versions is not claimed.']};
const infoName='release/'+prefix+'-build-info.json';await writeFile(dist+infoName,JSON.stringify(info,null,2)+'\n');hashes[infoName]=sha256(await readFile(dist+infoName));
await writeFile(dist+'SHA256SUMS.txt',Object.entries(hashes).map(([name,hash])=>hash+'  '+name).join('\n')+'\n');
console.log(JSON.stringify({buildDate:identity.label,directory:dist,files:[...Object.keys(hashes),'SHA256SUMS.txt'],nativeSelfTest:native.selfTest},null,2));
