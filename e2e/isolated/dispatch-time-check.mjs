import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const source=fs.readFileSync(new URL('../../admin/sales-supply-workspace.js',import.meta.url),'utf8');
const helper=source.match(/function localDispatchInstant\(value\)\{[\s\S]*?\n  \}/)?.[0];
assert.ok(helper,'Use the actual conversion owned by sales-supply-workspace.js');
assert.ok(source.includes("dispatched_at:localDispatchInstant(byId('supplyDispatchAt').value)"),'The real dispatch payload must use the tested helper');
const cases=[
  ['America/New_York','2026-09-09T10:15','2026-09-09T14:15:00.000Z'],
  ['America/New_York','2026-01-09T10:15','2026-01-09T15:15:00.000Z'],
  ['America/Los_Angeles','2026-09-09T10:15','2026-09-09T17:15:00.000Z'],
  ['Asia/Kolkata','2026-09-09T10:15','2026-09-09T04:45:00.000Z'],
  ['UTC','2026-09-09T10:15','2026-09-09T10:15:00.000Z']
];
for(const [tz,input,expected] of cases){
  const code=`import assert from 'node:assert/strict';\n${helper}\nassert.equal(localDispatchInstant(${JSON.stringify(input)}),${JSON.stringify(expected)});\nfor(const invalid of ['',null,'not-a-date'])assert.throws(()=>localDispatchInstant(invalid),error=>error.code==='DIRECT_DISPATCH_LOCAL_TIME_INVALID');`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,TZ:tz},timeout:5000});
  assert.equal(result.status,0,`${tz}: ${result.stderr||result.error||'failed'}`);
}
console.log('Direct Ship local instant: 5 timezone/date cases and 15 invalid-input checks passed.');
