// Read-only proposal. This module deliberately has no R2 delete or put calls.
// A complete record must have been verified offline (COMPLETE, manifest and
// object SHA-256) before it can participate in the retention policy.
export function planStorageRetention(records,{latestBackupId,now=new Date(),dailyCopies=30,monthlyCopies=12}={}) {
  if(!Array.isArray(records)||records.length>10000)throw Error('RETENTION_CATALOG_INVALID');
  if(!Number.isFinite(now.getTime())||!Number.isInteger(dailyCopies)||dailyCopies<1||dailyCopies>366
    ||!Number.isInteger(monthlyCopies)||monthlyCopies<1||monthlyCopies>120)throw Error('RETENTION_POLICY_INVALID');
  const ids=new Set(),valid=[],protectedCopies=[];
  for(const record of records){
    const id=record?.backupId;
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(id)||ids.has(id))throw Error('RETENTION_CATALOG_INVALID');
    ids.add(id);
    const stamp=Date.parse(record.completedAt);
    if(record.status!=='complete'||record.verified!==true||!Number.isFinite(stamp)||stamp>now.getTime()){
      protectedCopies.push({backupId:id,reason:'incomplete_unverified_or_future'});continue;
    }
    valid.push({backupId:id,completedAt:new Date(stamp).toISOString(),stamp});
  }
  if(!valid.some(record=>record.backupId===latestBackupId))throw Error('RETENTION_LATEST_NOT_VERIFIED');
  valid.sort((a,b)=>b.stamp-a.stamp||a.backupId.localeCompare(b.backupId));
  const kept=new Map(),days=new Set(),months=new Set();
  const keep=(record,reason)=>{
    if(!kept.has(record.backupId))kept.set(record.backupId,{backupId:record.backupId,completedAt:record.completedAt,reasons:[]});
    kept.get(record.backupId).reasons.push(reason);
  };
  for(const record of valid){
    const day=record.completedAt.slice(0,10),month=record.completedAt.slice(0,7);
    if(!days.has(day)&&days.size<dailyCopies){days.add(day);keep(record,'daily');}
    if(!months.has(month)&&months.size<monthlyCopies){months.add(month);keep(record,'monthly');}
    if(record.backupId===latestBackupId)keep(record,'latest');
  }
  return{dry_run:true,deletion_enabled:false,policy:{daily_copies:dailyCopies,monthly_copies:monthlyCopies,timezone:'UTC',selection:'newest verified copy per distinct day/month'},
    preserve:[...kept.values()],protected:protectedCopies,
    candidates:valid.filter(record=>!kept.has(record.backupId)).map(({stamp,...record})=>({...record,reason:'outside_proposed_retention'}))};
}
