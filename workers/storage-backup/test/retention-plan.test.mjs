import assert from 'node:assert/strict';
import test from 'node:test';
import {planStorageRetention} from '../src/retention-plan.js';

const record=(id,date,extra={})=>({backupId:id,status:'complete',verified:true,completedAt:date,...extra});
const now=new Date('2026-09-30T23:59:59Z');
test('retains 30 distinct daily points, 12 monthly points and the verified latest pointer',()=>{
  const records=[];
  for(let i=0;i<70;i++)records.push(record(`daily_${String(i).padStart(3,'0')}`,new Date(now.getTime()-i*86400000).toISOString()));
  for(let i=0;i<15;i++)records.push(record(`month_${String(i).padStart(3,'0')}`,new Date(Date.UTC(2026,8-i,1,1)).toISOString()));
  const plan=planStorageRetention(records,{latestBackupId:'month_014',now});
  assert.equal(plan.dry_run,true);assert.equal(plan.deletion_enabled,false);
  assert.equal(plan.preserve.filter(r=>r.reasons.includes('daily')).length,30);
  assert.equal(plan.preserve.filter(r=>r.reasons.includes('monthly')).length,12);
  assert.ok(plan.preserve.some(r=>r.backupId==='month_014'&&r.reasons.includes('latest')));
  assert.ok(!plan.candidates.some(r=>r.backupId==='month_014'));
  assert.equal(plan.preserve.length+plan.candidates.length,records.length);
});
test('same-day duplicates, UTC boundaries and missing days use distinct restore points',()=>{
  const records=[record('point_one','2026-09-30T23:00:00Z'),record('point_two','2026-09-30T23:30:00Z'),
    record('point_old','2026-08-31T23:59:59Z'),record('point_new','2026-09-01T00:00:00Z')];
  const plan=planStorageRetention(records,{latestBackupId:'point_two',now,dailyCopies:2,monthlyCopies:2});
  assert.deepEqual(plan.candidates.map(r=>r.backupId),['point_one']);
  assert.ok(plan.preserve.find(r=>r.backupId==='point_old').reasons.includes('monthly'));
});
test('never nominates incomplete, unverified, corrupted, future or malformed copies',()=>{
  const records=[record('latest_ok','2026-09-30T01:00:00Z'),
    record('partial_1','2026-01-01T00:00:00Z',{status:'incomplete'}),
    record('corrupt_1','2026-01-01T00:00:00Z',{verified:false}),
    record('bad_stamp','invalid'),record('future_1','2026-10-01T00:00:00Z')];
  const original=JSON.stringify(records),plan=planStorageRetention(records,{latestBackupId:'latest_ok',now});
  assert.equal(plan.protected.length,4);assert.equal(plan.candidates.length,0);
  assert.equal(JSON.stringify(records),original,'the planner must not mutate its catalog');
});
test('aborts if the latest pointer is missing/unverified or the catalog has duplicates',()=>{
  const latest=record('latest_ok','2026-09-30T01:00:00Z');
  assert.throws(()=>planStorageRetention([latest],{latestBackupId:'missing_id',now}),/LATEST_NOT_VERIFIED/);
  assert.throws(()=>planStorageRetention([{...latest,verified:false}],{latestBackupId:latest.backupId,now}),/LATEST_NOT_VERIFIED/);
  assert.throws(()=>planStorageRetention([latest,latest],{latestBackupId:latest.backupId,now}),/CATALOG_INVALID/);
});
