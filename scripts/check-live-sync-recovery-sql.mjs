import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const recovery = fs.readFileSync('supabase/migrations/20260909143701_live_sync_recovery.sql', 'utf8');
const original = fs.readFileSync('supabase/migrations/20260909125237_multiuser_live_sync.sql', 'utf8');
const db = new PGlite();
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.products(id integer primary key, name text, extra json);
    create table public.notification_inbox_items(id integer primary key, title text);
    create table public.team_memberships(team integer, member integer, primary key(team, member));
    create table public.web_push_runtime_state(singleton boolean primary key, updated_at timestamptz);
    create table public.audit_log(id integer primary key);
  `);
  await db.exec(original);
  const version = async scope => Number((await db.query(
    'select version from public.erp_change_state where scope=$1', [scope]
  )).rows[0].version);

  // Reproduce the old bug, then run the same operation against the correction.
  await db.exec('update public.products set name=name where false');
  assert.equal(await version('products'), 1, 'baseline reproduces false signals');
  await db.exec(recovery);
  const initial = await version('products');
  await db.exec('update public.products set name=name where false; delete from public.products where false;');
  await db.exec("insert into public.products select 1, 'A', null where false");
  assert.equal(await version('products'), initial, 'empty statements must not publish changes');

  await db.exec(`insert into public.products values (1,'A','{"nested":1}'),(2,'B',null)`);
  assert.equal(await version('products'), initial + 1, 'bulk insert publishes once');
  await db.exec('update public.products set name=name');
  assert.equal(await version('products'), initial + 1, 'identical rows are silent, including JSON/nulls');
  await db.exec("update public.products set name=name || '-changed'");
  assert.equal(await version('products'), initial + 2, 'bulk update publishes once');
  await db.exec("insert into public.products values (1,'ignored',null) on conflict(id) do nothing");
  assert.equal(await version('products'), initial + 2, 'deduplicated writes are silent');
  await db.exec("insert into public.products values (1,'A-changed','{\"nested\":1}') on conflict(id) do update set name=excluded.name");
  assert.equal(await version('products'), initial + 2, 'identical UPSERT is silent');
  await db.exec("insert into public.products values (1,'A-updated',null) on conflict(id) do update set name=excluded.name");
  assert.equal(await version('products'), initial + 3, 'UPSERT with changed data publishes once');
  await db.exec('begin; delete from public.products; rollback;');
  assert.equal(await version('products'), initial + 3, 'rollback must not publish changes');

  await db.exec('grant select, update, insert, delete on public.products to service_role');
  await db.exec("set role service_role; update public.products set name='backend'; reset role;");
  assert.equal(await version('products'), initial + 4, 'protected trigger works for backend writes');
  await db.exec('delete from public.products');
  assert.equal(await version('products'), initial + 5, 'bulk delete publishes once');
  await db.exec('insert into public.team_memberships values(1,1),(1,2)');
  await db.exec('update public.team_memberships set member=member');
  assert.equal(await version('account'), 1, 'composite-key table preserves scoped, no-op semantics');

  await db.exec("insert into public.notification_inbox_items values(1,'Notification')");
  const notified = await version('notifications');
  for (let n=0; n<3; n+=1) {
    await db.exec("insert into public.notification_inbox_items values(1,'Notification') on conflict(id) do nothing");
    await db.exec('update public.notification_inbox_items set title=title where false');
  }
  assert.equal(await version('notifications'), notified, 'repeated reconciliation must settle');
  await db.exec('insert into public.web_push_runtime_state values(true,now()); update public.web_push_runtime_state set updated_at=now();');
  assert.equal(await version('notifications'), notified, 'internal cursor changes must not wake up the UI');
  await db.exec(recovery);
  assert.equal(await version('notifications'), notified, 'reapplying migration preserves versions');
  const triggers = await db.query("select count(*)::int as total from pg_trigger where tgfoid='private.bump_erp_change_state()'::regprocedure");
  assert.equal(triggers.rows[0].total, 9, 'exactly three event triggers per mapped table');
  assert.equal((await db.query("select count(*)::int as total from pg_trigger where tgname='erp_change_state_bump'")).rows[0].total, 0);
  const security = (await db.query(`select
    has_table_privilege('anon','public.erp_change_state','select') as anon_read,
    has_table_privilege('authenticated','public.erp_change_state','select') as user_read,
    has_table_privilege('service_role','public.erp_change_state','select') as server_read,
    has_table_privilege('service_role','public.erp_change_state','update') as server_write,
    has_function_privilege('service_role','private.bump_erp_change_state()','execute') as server_execute
  `)).rows[0];
  assert.deepEqual(security, {anon_read:false,user_read:false,server_read:true,server_write:false,server_execute:false});
  console.log('Live sync real-change SQL regression: OK');
} finally {
  await db.close();
}
