import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSidx,makeGroups,groupAt} from '../src/dash.js';
function sidx(count=3,version=0){
  const bytes=new Uint8Array((version?40:32)+count*12),v=new DataView(bytes.buffer);
  v.setUint32(0,bytes.length);bytes.set([115,105,100,120],4);bytes[8]=version;v.setUint32(12,1);v.setUint32(16,48000);
  const first=version?40:32;v.setUint16(first-2,count);
  for(let i=0;i<count;i++){v.setUint32(first+i*12,480000);v.setUint32(first+i*12+4,480000);}
  return bytes;
}
test('sidx maps a 25-minute source directly to the requested byte range',()=>{
  const bytes=sidx(151),refs=parseSidx(bytes,683,100000000),groups=makeGroups(refs);
  assert.equal(groups.length,151);const g=groups[groupAt(groups,1250.5)];
  assert.equal(g.start,1250);assert.equal(g.end,1260);assert.equal(g.trim,10);
  assert.equal(g.byteEnd-g.byteStart+1,960000);assert.ok(g.byteStart>59000000);
});
test('64-bit sidx and first_offset are respected',()=>{
  const bytes=sidx(2,1),v=new DataView(bytes.buffer);v.setUint32(24,480000);v.setUint32(32,50);
  const refs=parseSidx(bytes,200,10000000);assert.equal(refs[0].start,10);assert.equal(refs[0].byteStart,200+bytes.length+50);
});
test('malformed, hierarchical and out-of-file references are rejected',()=>{
  assert.throws(()=>parseSidx(sidx().subarray(0,20)));
  const bytes=sidx();new DataView(bytes.buffer).setUint32(32,0x80000001);assert.throws(()=>parseSidx(bytes));
  assert.throws(()=>parseSidx(sidx(),0,100));
});
test('grouping preserves timeline and includes one prior fragment for decoder history',()=>{
  const refs=parseSidx(sidx(5),0,10000000),groups=makeGroups(refs,19);
  assert.deepEqual(groups.map(g=>[g.start,g.end,g.trim]),[[0,20,0],[20,40,10],[40,50,10]]);
  assert.equal(groupAt(groups,20),1);assert.equal(groupAt(groups,49),2);
});
