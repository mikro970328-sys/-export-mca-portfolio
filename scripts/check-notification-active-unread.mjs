import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const migrationPath='supabase/migrations/20260904091137_inactive_notifications_not_unread.sql';
const migration=fs.readFileSync(migrationPath,'utf8');

assert.match(migration,/with \(security_invoker=true\)/);
assert.match(migration,/inbox_source_state\.source_active[\s\S]*?read_at is null[\s\S]*?dismissed_at is null/);
assert.match(migration,/revoke all on public\.notification_inbox_workspace from public,anon,authenticated/);
assert.match(migration,/grant select on public\.notification_inbox_workspace to service_role/);

const db=new PGlite({extensions:{pgcrypto}});
await db.waitReady;
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create extension if not exists pgcrypto;
  create table public.operational_tasks(
    id uuid primary key default gen_random_uuid(),status text not null,due_at timestamptz,
    assignment_state_changed_at timestamptz not null
  );
  create table public.notifications(
    id uuid primary key default gen_random_uuid(),alert_status text not null
  );
  create table public.operational_alert_conditions(
    notification_id uuid primary key references public.notifications(id),condition_active boolean not null,
    condition_cycle_count integer not null
  );
  create table public.notification_inbox_items(
    id uuid primary key default gen_random_uuid(),recipient_admin_id uuid not null,
    source_type text not null,source_id uuid not null,source_version text not null,source_event_type text not null,
    read_at timestamptz,dismissed_at timestamptz
  );
`);
await db.exec(migration);

const taskId='00000000-0000-4000-8000-000000000001';
const recipientId='00000000-0000-4000-8000-000000000002';
const assignmentVersion='2026-09-04T03:00:00.000000Z';
await db.query(`insert into public.operational_tasks(id,status,assignment_state_changed_at) values($1,'pending','2026-09-04T03:00:00Z')`,[taskId]);
await db.query(`
  insert into public.notification_inbox_items(recipient_admin_id,source_type,source_id,source_version,source_event_type,read_at)
  values
    ($1,'task',$2,$3,'task_assigned',null),
    ($1,'task',$2,'superseded-version','task_assigned',null),
    ($1,'system',gen_random_uuid(),'current','tracking_status_changed',null),
    ($1,'system',gen_random_uuid(),'read','tracking_status_changed',now())
`,[recipientId,taskId,assignmentVersion]);

let result=await db.query(`
  select source_version,source_active,is_unread
  from public.notification_inbox_workspace
  order by source_version
`);
const rows=Object.fromEntries(result.rows.map(row=>[row.source_version,row]));
assert.equal(rows[assignmentVersion].source_active,true);
assert.equal(rows[assignmentVersion].is_unread,true);
assert.equal(rows['superseded-version'].source_active,false);
assert.equal(rows['superseded-version'].is_unread,false,'una fuente inactiva no debe contar como no leída');
assert.equal(rows.current.is_unread,true);
assert.equal(rows.read.is_unread,false);

result=await db.query(`
  select
    has_table_privilege('anon','public.notification_inbox_workspace','SELECT') as anon_can_read,
    has_table_privilege('authenticated','public.notification_inbox_workspace','SELECT') as authenticated_can_read,
    has_table_privilege('service_role','public.notification_inbox_workspace','SELECT') as service_can_read
`);
assert.equal(result.rows[0].anon_can_read,false);
assert.equal(result.rows[0].authenticated_can_read,false);
assert.equal(result.rows[0].service_can_read,true);
await db.close();

console.log('Active-only unread notification contract: OK');
