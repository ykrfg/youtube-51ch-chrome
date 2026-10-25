// SPDX-License-Identifier: GPL-3.0-or-later
import {spawnSync} from 'node:child_process';import {readFile,writeFile} from 'node:fs/promises';
import {root,nativeSourceHashes,sha256} from './files.mjs';
if(process.platform!=='win32')throw new Error('The Windows native host must be built on Windows with MSVC and the Windows SDK.');
const build=spawnSync('cmd.exe',['/d','/c','build.cmd'],{cwd:root+'native',windowsHide:true,stdio:'inherit'});
if(build.error||build.status!==0)throw new Error('Native build failed. Install Visual Studio Build Tools: Desktop development with C++ and a Windows 10/11 SDK.');
const binary=root+'native/youtube-surround-host.exe';
const check=spawnSync(binary,['--self-test'],{windowsHide:true,encoding:'utf8'});
if(check.status!==0||JSON.parse(check.stdout).selfTest!=='PASS')throw new Error('Native self-test failed.');
await writeFile(root+'native/build-info.json',JSON.stringify({sources:await nativeSourceHashes(),binarySha256:sha256(await readFile(binary)),selfTest:JSON.parse(check.stdout)},null,2)+'\n');
console.log('Native host built and self-tested. No installation or registry changes were performed.');
