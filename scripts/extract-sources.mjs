// SPDX-License-Identifier: GPL-3.0-or-later
import {unzipSync} from 'fflate';import {mkdir,writeFile,chmod} from 'node:fs/promises';import path from 'node:path';
// GitHub source ZIPs use ordinary central-directory Unix attributes. Preserve
// executable bits, and materialize file symlinks so Windows needs no privilege.
function modes(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=bytes.length-22;
 for(;end>=Math.max(0,bytes.length-65557);end--)if(view.getUint32(end,true)===0x06054b50)break;
 if(end<0)throw new Error('Missing ZIP directory');
 let cursor=view.getUint32(end+16,true);const count=view.getUint16(end+10,true),result=new Map(),decoder=new TextDecoder();
 for(let i=0;i<count;i++){
  if(view.getUint32(cursor,true)!==0x02014b50)throw new Error('Invalid ZIP directory');
  const length=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true);
  result.set(decoder.decode(bytes.subarray(cursor+46,cursor+46+length)),view.getUint32(cursor+38,true)>>>16);cursor+=46+length+extra+comment;
 }
 return result;
}
export async function extractSourceArchive(bytes,folder){
 const entries=unzipSync(bytes),attributes=modes(bytes),directories=new Set();
 for(const [name,original] of Object.entries(entries)){
  const parts=name.split('/');const archiveRoot=parts.shift();if(!parts.length||!parts.at(-1))continue;
  if(!archiveRoot||parts.some(p=>!p||p==='..'||p==='.'||p.includes('\\')||p.includes(':')))throw new Error('Unsafe source archive path');
  let data=original,mode=attributes.get(name)||0,link=name;
  for(let depth=0;(mode&0o170000)===0o120000;depth++){
   if(depth>8)throw new Error('Source symlink cycle');
   link=path.posix.normalize(path.posix.join(path.posix.dirname(link),new TextDecoder().decode(data)));
   if(!link.startsWith(archiveRoot+'/')||!Object.hasOwn(entries,link))throw new Error('Unsafe source symlink');
   data=entries[link];mode=attributes.get(link)||0;
  }
  const target=path.join(folder,...parts),parent=path.dirname(target);
  if(!directories.has(parent)){await mkdir(parent,{recursive:true});directories.add(parent);}
  await writeFile(target,data);if(process.platform!=='win32')await chmod(target,(mode&0o777)||0o644);
 }
}
