const MAX_FRAGMENT = 16 * 1024 * 1024;
function safe(n) { if (!Number.isSafeInteger(n) || n < 0) throw new Error('索引の数値が不正です。'); return n; }
export function parseSidx(bytes, absoluteStart = 0, fileSize = Infinity) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = p => v.getUint32(p);
  const u64 = p => safe(u32(p)*4294967296 + u32(p+4));
  for (let box = 0; box + 8 <= bytes.length;) {
    let size = u32(box), header = 8;
    if (size === 1) { size = u64(box+8); header = 16; }
    if (size < header || box+size > bytes.length) throw new Error('MP4索引が途中で切れています。');
    const type = String.fromCharCode(...bytes.subarray(box+4,box+8));
    if (type !== 'sidx') { box += size; continue; }
    let p = box+header;
    const version = bytes[p]; p+=4;
    if (version !== 0 && version !== 1) throw new Error('未対応のMP4索引です。');
    p+=4; const scale=u32(p);p+=4;
    if (!scale) throw new Error('音声の時間単位が不正です。');
    let time=version ? u64(p) : u32(p); p+=version?8:4;
    const firstOffset=version?u64(p):u32(p);p+=version?8:4;
    p+=2;const count=v.getUint16(p);p+=2;
    if (!count || count>100000 || p+count*12>box+size) throw new Error('音声の索引が不正です。');
    let offset=safe(absoluteStart+box+size+firstOffset);
    const refs=[];
    for(let i=0;i<count;i++,p+=12) {
      const ref=u32(p), length=ref&0x7fffffff, ticks=u32(p+4);
      if (ref>>>31) throw new Error('階層化された索引にはまだ対応していません。');
      if (!length || length>MAX_FRAGMENT || !ticks || ticks/scale>120) throw new Error('音声区間が対応サイズを超えています。');
      const endByte=safe(offset+length-1);
      if (endByte>=fileSize) throw new Error('索引が音声ファイルの範囲を超えています。');
      refs.push({id:i, start:time/scale, end:(time+ticks)/scale, byteStart:offset, byteEnd:endByte});
      offset=endByte+1;time=safe(time+ticks);
    }
    return refs;
  }
  throw new Error('音声の区間索引（sidx）が見つかりません。');
}
export function makeGroups(refs, targetSeconds=9.5) {
  const groups=[];
  for(let first=0;first<refs.length;) {
    let last=first;
    while(last+1<refs.length && refs[last].end-refs[first].start<targetSeconds) last++;
    const prior=refs[Math.max(0,first-1)];
    groups.push({id:groups.length,start:refs[first].start,end:refs[last].end,
      byteStart:prior.byteStart,byteEnd:refs[last].byteEnd,trim:refs[first].start-prior.start});
    first=last+1;
  }
  return groups;
}
export function groupAt(groups,time) {
  let low=0,high=groups.length-1;
  while(low<=high) {const mid=(low+high)>>1,g=groups[mid];if(time<g.start)high=mid-1;else if(time>=g.end)low=mid+1;else return mid;}
  return time>=groups.at(-1)?.end ? groups.length-1 : 0;
}
