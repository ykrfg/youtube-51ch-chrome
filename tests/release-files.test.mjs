import {test} from 'node:test';import assert from 'node:assert/strict';
import {projectFiles,runtimeFiles,runtimeReadme,readJson,sha256} from '../scripts/files.mjs';import {readFile} from 'node:fs/promises';
import {buildIdentity} from '../scripts/build-date.mjs';
test('public source archive excludes installed-machine configuration and generated binaries',async()=>{
 const files=await projectFiles();
 for(const file of files)assert.ok(!file.startsWith('.cache/')&&!file.startsWith('node_modules/')&&!file.startsWith('dist/')&&!file.startsWith('extension/vendor/')&&!file.startsWith('extension/_metadata/')&&!/\.(exe|wasm|obj|pdb)$/i.test(file));
 assert.ok(!files.includes('native/jp.local.youtube_surround_audio.json'));assert.ok(!files.includes('extension/processor.js'));
 for(const file of ['LICENSE','NOTICE','package-lock.json','native/host.cpp','native/vendor/json.hpp','src/extractor.js','docs/BUILDING.md','.github/workflows/ci.yml'])assert.ok(files.includes(file),file);
});
test('runtime archive contains required assets and notices without development code',async()=>{
 const files=await runtimeFiles();assert.ok(!files.includes('native/jp.local.youtube_surround_audio.json'));assert.ok(!files.includes('native/build-info.json'));
 for(const file of files)assert.ok(!/^(src|tests|scripts|docs|third_party|\.github)\//.test(file)&&!file.startsWith('native/vendor/')&&!/\.(cpp|hpp|obj|pdb|mjs|cjs)$/.test(file),file);
 for(const file of ['extension/manifest.json','extension/processor.js','extension/vendor/ffmpeg-core.wasm','native/youtube-surround-host.exe','native/Install.cmd','native/Uninstall.cmd','native/extension-id.txt','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md'])assert.ok(files.includes(file),file);
 const readme=runtimeReadme(await readFile(new URL('../README.md',import.meta.url),'utf8'));assert.ok(readme.includes('SOURCE.md'));assert.ok(!readme.includes('npm ci'));assert.ok(!readme.includes('](docs/'));assert.ok(!readme.includes('](TEST_RESULTS.md)'));
});
test('project version and fixed extension ID agree with the native host',async()=>{
 const pkg=await readJson('package.json'),manifest=await readJson('extension/manifest.json'),date=await readJson('build-date.json'),identity=buildIdentity(date.date,date.revision);assert.equal(pkg.version,identity.packageVersion);assert.equal(manifest.version,identity.extensionVersion);assert.equal(manifest.version_name,identity.label);assert.equal(pkg.license,'GPL-3.0-or-later');
 const id=sha256(Buffer.from(manifest.key,'base64')).slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
 assert.equal(id,(await readFile(new URL('../native/extension-id.txt',import.meta.url),'utf8')).trim());
});
test('all FFmpeg source archives have immutable revisions and checksums',async()=>{
 const manifest=await readJson('third_party/ffmpeg-sources.lock.json');assert.equal(manifest.coreVersion,'0.12.10');assert.equal(manifest.sources.length,19);
 for(const item of manifest.sources){assert.match(item.revision,/^[a-f0-9]{40}$/);assert.match(item.sha256,/^[a-f0-9]{64}$/);assert.ok(item.url.endsWith(item.revision));assert.ok(item.bytes>0);}
});
