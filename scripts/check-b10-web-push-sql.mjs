import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions:{ pgcrypto } });
await db.waitReady;

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create extension if not exists pgcrypto;
  create table public.admin_users(
    id uuid primary key default gen_random_uuid(), username text not null, role text not null default 'admin',
    is_active boolean not null default true, session_version integer not null default 1,
    can_notify boolean not null default false
  );
  create table public.audit_log(
    id uuid primary key default gen_random_uuid(), actor_admin_id uuid, actor_username text,
    action text not null, entity_type text not null, entity_id uuid, details jsonb, created_at timestamptz not null default now()
  );
  create table public.notification_preferences(
    admin_user_id uuid primary key references public.admin_users(id) on delete cascade,
    in_app_enabled boolean not null default true, task_assignments_enabled boolean not null default true,
    operational_alerts_enabled boolean not null default true, escalations_enabled boolean not null default true,
    whatsapp_enabled boolean not null default false, whatsapp_recipient text,
    email_enabled boolean not null default false, email_recipient text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table public.notification_inbox_items(
    id uuid primary key default gen_random_uuid(), recipient_admin_id uuid not null references public.admin_users(id),
    source_type text not null, source_id uuid not null, source_version text not null, source_event_type text not null,
    target_type text not null, target_id uuid, title text not null, message text, severity text not null default 'info',
    entity_type text, entity_id uuid, action_key text not null default 'open_work', action_payload jsonb not null default '{}'::jsonb,
    escalation_level integer not null default 0, read_at timestamptz, dismissed_at timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint notification_inbox_semantic_unique unique(recipient_admin_id,source_type,source_id,source_version,escalation_level)
  );
  create table public.operational_tasks(
    id uuid primary key default gen_random_uuid(), title text not null, description text, status text not null default 'pending',
    priority text not null default 'normal', due_at timestamptz, assigned_team_id uuid, assigned_admin_id uuid,
    workflow_key text, entity_type text, entity_id uuid, assignment_state_changed_at timestamptz not null default now()
  );
  create table public.shipments(
    id uuid primary key default gen_random_uuid(), container_number text not null, last_status text, operational_status text,
    last_event_at timestamptz, created_at timestamptz not null default now()
  );
  create table public.documents(
    id uuid primary key default gen_random_uuid(), version integer not null default 1, created_at timestamptz not null default now(),
    deleted_at timestamptz, superseded_at timestamptz, shipment_id uuid, load_id uuid, source_type text, source_id uuid,
    document_type text not null
  );
  create table public.notifications(
    id uuid primary key default gen_random_uuid(), notification_scope text not null default 'message', updated_at timestamptz not null default now(),
    attempt_count integer not null default 0, channel text not null default 'whatsapp', shipment_id uuid, entity_type text, entity_id uuid,
    delivery_status text, status text, alert_status text
  );
  create table public.webhook_events(
    id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(), provider text,
    container_number text, processed boolean not null default false, error_message text
  );
  create table public.operational_alert_conditions(
    notification_id uuid primary key, condition_active boolean not null default true,
    condition_cycle_count integer not null default 1
  );
  create or replace view public.notification_inbox_workspace as
    select i.*,true as source_active,'active'::text as source_status,
      (i.read_at is null and i.dismissed_at is null) as is_unread
    from public.notification_inbox_items i;
  create or replace function public.notification_user_eligible(
    p_admin_user_id uuid,
    p_required_permissions text[] default '{}'::text[]
  ) returns boolean language sql stable as $$
    select exists(
      select 1 from public.admin_users
      where id=p_admin_user_id and is_active=true and can_notify=true
    )
  $$;
  create or replace function public.notification_task_recipients(p_task_id uuid)
  returns table(admin_user_id uuid,target_type text,target_id uuid)
  language sql stable as $$
    select assigned_admin_id,'user'::text,assigned_admin_id
    from public.operational_tasks
    where id=p_task_id and assigned_admin_id is not null
      and public.notification_user_eligible(assigned_admin_id,'{}'::text[])
  $$;
`);

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260903233021_b10_1_web_push_notifications.sql', import.meta.url),
  'utf8'
);
await db.exec(migration);

const userId = '00000000-0000-4000-8000-000000000001';
const deniedUserId = '00000000-0000-4000-8000-000000000008';
const expiringUserId = '00000000-0000-4000-8000-000000000009';
await db.query(`
  insert into public.admin_users(id,username,role,is_active,session_version,can_notify)
  values
    ($1,'tester','admin',true,1,true),
    ($2,'denied','admin',true,1,false)
`, [userId, deniedUserId]);

const endpoint = 'https://push.example.test/subscription/one';
const registered = await db.query(`
  select * from public.upsert_push_subscription($1,1,$2,$3,$4,null,'iPhone · Safari','test-agent',now())
`, [userId, endpoint, 'A'.repeat(87), 'B'.repeat(22)]);
assert.equal(registered.rows.length, 1);
const subscriptionId = registered.rows[0].subscription_id;

const taskId = '00000000-0000-4000-8000-000000000002';
const shipmentId = '00000000-0000-4000-8000-000000000003';
const documentId = '00000000-0000-4000-8000-000000000004';
const failureId = '00000000-0000-4000-8000-000000000005';
const webhookId = '00000000-0000-4000-8000-000000000006';
await db.query(`insert into public.operational_tasks(id,title,due_at,assigned_admin_id,entity_type,entity_id) values($1,'Revisar carga',now()+interval '1 hour',$2,'shipment',$3)`, [taskId,userId,shipmentId]);
await db.query(`insert into public.shipments(id,container_number,last_status,operational_status,last_event_at) values($1,'ABCD1234567','Liberado','Liberado',now())`, [shipmentId]);
await db.query(`insert into public.documents(id,shipment_id,document_type) values($1,$2,'Bill of Lading')`, [documentId,shipmentId]);
await db.query(`insert into public.notifications(id,delivery_status,status) values($1,'failed','failed')`, [failureId]);
await db.query(`insert into public.webhook_events(id,provider,container_number,error_message) values($1,'tracking','ABCD1234567','internal failure')`, [webhookId]);

const reconciled = await db.query(`select public.reconcile_web_push_notifications(now()) as result`);
const result = reconciled.rows[0].result;
assert.equal(result.task_due_notifications_created, 1);
assert.equal(result.tracking_notifications_created, 1);
assert.equal(result.document_notifications_created, 1);
assert.equal(result.integration_notifications_created, 2);
assert.equal(result.push_deliveries_queued, 5);

const deniedInbox = await db.query(`select count(*)::integer as count from public.notification_inbox_items where recipient_admin_id=$1`, [deniedUserId]);
assert.equal(deniedInbox.rows[0].count, 0);

const second = await db.query(`select public.reconcile_web_push_notifications(now()) as result`);
assert.equal(second.rows[0].result.push_deliveries_queued, 0);
const queueCount = await db.query(`select count(*)::integer as count from public.push_delivery_queue`);
assert.equal(queueCount.rows[0].count, 5);
const dueActivity = await db.query(`select source_active,source_status from public.notification_inbox_workspace where source_event_type='task_due'`);
assert.deepEqual(dueActivity.rows[0], { source_active:true, source_status:'pending' });

await db.query(`update public.operational_tasks set status='completed' where id=$1`, [taskId]);
await db.query(`select public.reconcile_web_push_notifications(now())`);
const staleDue = await db.query(`
  select q.status,q.last_error_code
  from public.push_delivery_queue q
  join public.notification_inbox_items i on i.id=q.inbox_item_id
  where i.source_event_type='task_due'
`);
assert.deepEqual(staleDue.rows[0], { status:'suppressed', last_error_code:'source_inactive' });

const lease = '00000000-0000-4000-8000-000000000007';
const claimed = await db.query(`select * from public.claim_push_deliveries(10,$1,now())`, [lease]);
assert.equal(claimed.rows.length, 4);
assert(claimed.rows.every(row => row.endpoint === endpoint));
assert(claimed.rows.every(row => row.deep_link.startsWith('/admin/pwa.html?notification=')));
await db.query(`select public.complete_push_delivery($1,$2,'sent',201,null,null,now())`, [claimed.rows[0].delivery_id,lease]);
const delivery = await db.query(`select status,attempt_count from public.push_delivery_queue where id=$1`, [claimed.rows[0].delivery_id]);
assert.deepEqual(delivery.rows[0], { status:'sent', attempt_count:1 });

await db.query(`update public.admin_users set can_notify=false where id=$1`, [userId]);
await db.query(`select public.reconcile_web_push_notifications(now())`);
const revokedByAccess = await db.query(`select status,last_error_code from public.push_subscriptions where id=$1`, [subscriptionId]);
assert.deepEqual(revokedByAccess.rows[0], { status:'revoked', last_error_code:'access_revoked' });
const remainingActive = await db.query(`select count(*)::integer as count from public.push_delivery_queue where status in ('pending','retry','processing')`);
assert.equal(remainingActive.rows[0].count, 0);

await db.query(`
  insert into public.admin_users(id,username,role,is_active,session_version,can_notify)
  values($1,'expiring','admin',true,1,true)
`, [expiringUserId]);
const expiringEndpoint = 'https://push.example.test/subscription/expiring';
const expiringRegistered = await db.query(`
  select * from public.upsert_push_subscription(
    $1,1,$2,$3,$4,now()+interval '1 minute','Android · Chrome','test-agent',now()
  )
`, [expiringUserId,expiringEndpoint,'C'.repeat(87),'D'.repeat(22)]);
const expiringSubscriptionId = expiringRegistered.rows[0].subscription_id;
await db.query(`select public.reconcile_web_push_notifications(now()+interval '2 minutes')`);
const expiredSubscription = await db.query(`select status,last_error_code from public.push_subscriptions where id=$1`, [expiringSubscriptionId]);
assert.deepEqual(expiredSubscription.rows[0], { status:'expired', last_error_code:'subscription_expired' });

await db.query(`select * from public.deactivate_push_subscription($1,1,$2,null,'logout',now())`, [userId,subscriptionId]);
const subscription = await db.query(`select status,last_error_code from public.push_subscriptions where id=$1`, [subscriptionId]);
assert.deepEqual(subscription.rows[0], { status:'revoked', last_error_code:'logout' });
const preference = await db.query(`select push_enabled from public.notification_preferences where admin_user_id=$1`, [userId]);
assert.equal(preference.rows[0].push_enabled, false);

const auditSecrets = await db.query(`
  select count(*)::integer as count
  from public.audit_log
  where details::text like '%push.example.test%' or details::text like '%${'A'.repeat(30)}%'
`);
assert.equal(auditSecrets.rows[0].count, 0);

console.log('B10.1 PostgreSQL lifecycle and authorization: OK');
await db.close();
