import {test} from 'node:test';import assert from 'node:assert/strict';
import {buildIdentity,jstDate} from '../scripts/build-date.mjs';
test('date labels map to legal Chrome and npm versions, including same-day revisions',()=>{
 const first=buildIdentity('2026-01-05');assert.equal(first.label,'2026-01-05');assert.equal(first.extensionVersion,'2026.1.5');assert.equal(first.packageVersion,'2026.1.5');
 const next=buildIdentity('2026-01-05',2);assert.equal(next.label,'2026-01-05-2');assert.equal(next.extensionVersion,'2026.1.5.2');assert.equal(next.packageVersion,'2026.1.5-build.2');
});
test('build date uses Japan time at the UTC day boundary',()=>{
 assert.equal(jstDate(new Date('2026-10-24T14:59:59Z')),'2026-10-24');assert.equal(jstDate(new Date('2026-10-24T15:00:00Z')),'2026-10-25');
});
test('invalid calendar dates and revisions fail before writing build metadata',()=>{
 for(const date of ['2026-02-29','2026-13-01','2026-1-05','0000-01-01'])assert.throws(()=>buildIdentity(date));
 for(const revision of [-1,65536,0.5,NaN])assert.throws(()=>buildIdentity('2026-10-25',revision));
 assert.doesNotThrow(()=>buildIdentity('2028-02-29',65535));
});
