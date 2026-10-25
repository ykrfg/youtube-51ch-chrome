// SPDX-License-Identifier: GPL-3.0-or-later
import {readFile,writeFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
import {root} from './files.mjs';
export const jstDate=(now=new Date())=>new Date(now.getTime()+9*60*60*1000).toISOString().slice(0,10);
export function buildIdentity(date,revision=0){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number(date.slice(0,4))<1||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Build date must be a real date in YYYY-MM-DD format');
 if(!Number.isInteger(revision)||revision<0||revision>65535)throw new Error('Build revision must be an integer between 0 and 65535');
 const base=date.split('-').map(Number).join('.');
 return {date,revision,timeZone:'Asia/Tokyo',label:date+(revision?'-'+revision:''),extensionVersion:base+(revision?'.'+revision:''),packageVersion:base+(revision?'-build.'+revision:'')};
}
export async function stampBuild(){
 let previous;try{previous=JSON.parse(await readFile(root+'build-date.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const date=process.env.BUILD_DATE||jstDate();
 const revision=process.env.BUILD_REVISION!==undefined&&process.env.BUILD_REVISION!==''?Number(process.env.BUILD_REVISION):(previous?.date===date?previous.revision:0);
 const identity=buildIdentity(date,revision);
 const pkg=JSON.parse(await readFile(root+'package.json','utf8')),lock=JSON.parse(await readFile(root+'package-lock.json','utf8')),manifest=JSON.parse(await readFile(root+'extension/manifest.json','utf8'));
 pkg.version=identity.packageVersion;lock.version=identity.packageVersion;lock.packages[''].version=identity.packageVersion;
 manifest.version=identity.extensionVersion;manifest.version_name=identity.label;
 for(const [file,value] of [['build-date.json',{date,revision,timeZone:'Asia/Tokyo'}],['package.json',pkg],['package-lock.json',lock],['extension/manifest.json',manifest]])await writeFile(root+file,JSON.stringify(value,null,2)+'\n');
 return identity;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await stampBuild()));
