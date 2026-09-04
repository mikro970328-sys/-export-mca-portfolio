import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const migration=fs.readFileSync('supabase/migrations/20260904020033_container_tracking_assignment_notifications.sql','utf8');

assert.match(migration,/create or replace function public\.notify_load_container_assignment\(/);
assert.match(migration,/perform public\.notify_load_container_assignment\(v_load\.id,p_shipment_id\)/);
assert.match(migration,/perform public\.notify_load_container_assignment\(v_load\.id,v_shipment\.id\)/);
assert.match(migration,/'Contenedor asignado a Tracking'/);
assert.match(migration,/'tracking_status_changed'/);
assert.match(migration,/array\['logistics\.read'\]::text\[\]/);
assert.match(migration,/coalesce\(pref\.in_app_enabled,true\)=true/);
assert.match(migration,/coalesce\(pref\.tracking_updates_enabled,true\)=true/);
assert.match(migration,/'info','shipment',p_shipment_id,'open_work'/);
assert.match(migration,/container_assignment:'\|\|p_shipment_id::text/);
assert.match(migration,/on conflict on constraint notification_inbox_semantic_unique do nothing/);
assert.match(migration,/revoke all on function public\.notify_load_container_assignment\(uuid,uuid\)[\s\S]*?from public,anon,authenticated,service_role/);
assert.doesNotMatch(migration,/grant execute on function public\.notify_load_container_assignment/);

const db=new PGlite({extensions:{pgcrypto}});
await db.waitReady;
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create extension if not exists pgcrypto;
  create table public.admin_users(
    id uuid primary key default gen_random_uuid(),username text not null,
    role text not null default 'admin',is_active boolean not null default true,can_notify boolean not null default true
  );
  create table public.notification_preferences(
    admin_user_id uuid primary key references public.admin_users(id),
    in_app_enabled boolean not null default true,tracking_updates_enabled boolean not null default true
  );
  create table public.shipments(
    id uuid primary key default gen_random_uuid(),container_number text not null,
    client_id uuid,importer_id uuid,booking_number text,bol_number text,carrier text,departure_date date
  );
  create table public.loads(
    id uuid primary key default gen_random_uuid(),load_number text not null,shipment_id uuid references public.shipments(id),
    status text not null default 'draft',updated_at timestamptz not null default now()
  );
  create table public.notification_inbox_items(
    id uuid primary key default gen_random_uuid(),recipient_admin_id uuid not null references public.admin_users(id),
    source_type text not null,source_id uuid not null,source_version text not null,source_event_type text not null,
    target_type text not null,target_id uuid,title text not null,message text,severity text not null,
    entity_type text,entity_id uuid,action_key text not null,action_payload jsonb not null default '{}'::jsonb,
    escalation_level integer not null default 0,read_at timestamptz,dismissed_at timestamptz,
    created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
    constraint notification_inbox_semantic_unique unique(recipient_admin_id,source_type,source_id,source_version,escalation_level)
  );
  create or replace function public.notification_user_eligible(p_admin_user_id uuid,p_required_permissions text[] default '{}'::text[])
  returns boolean language sql stable as $$
    select exists(select 1 from public.admin_users where id=p_admin_user_id and is_active=true and can_notify=true)
  $$;
  create or replace function public.assert_load_action(p_load_id uuid,p_action text)
  returns void language plpgsql as $$ begin return; end $$;
  create or replace function public.assign_load_shipment(p_load_id uuid,p_shipment_id uuid)
  returns public.loads language plpgsql as $$
  declare v_load public.loads;
  begin
    update public.loads set shipment_id=p_shipment_id,updated_at=clock_timestamp() where id=p_load_id returning * into v_load;
    return v_load;
  end $$;
  create or replace function public.create_load_shipment(
    p_load_id uuid,p_container_number text,p_client_id uuid default null,p_importer_id uuid default null,
    p_booking_number text default null,p_bol_number text default null,p_carrier text default null,p_departure_date date default null
  ) returns public.shipments language plpgsql as $$
  declare v_shipment public.shipments;
  begin
    insert into public.shipments(container_number,client_id,importer_id,booking_number,bol_number,carrier,departure_date)
    values(p_container_number,p_client_id,p_importer_id,p_booking_number,p_bol_number,p_carrier,p_departure_date)
    returning * into v_shipment;
    update public.loads set shipment_id=v_shipment.id,updated_at=clock_timestamp() where id=p_load_id;
    return v_shipment;
  end $$;
`);
await db.exec(migration);

const activeUser='00000000-0000-4000-8000-000000000001';
const optedOutUser='00000000-0000-4000-8000-000000000002';
const shipmentId='00000000-0000-4000-8000-000000000003';
const loadId='00000000-0000-4000-8000-000000000004';
const createLoadId='00000000-0000-4000-8000-000000000005';
await db.query(`insert into public.admin_users(id,username) values($1,'logistica'),($2,'sin-avisos')`,[activeUser,optedOutUser]);
await db.query(`insert into public.notification_preferences(admin_user_id,tracking_updates_enabled) values($1,false)`,[optedOutUser]);
await db.query(`insert into public.shipments(id,container_number) values($1,'TEST1234567')`,[shipmentId]);
await db.query(`insert into public.loads(id,load_number) values($1,'CG-QA-1'),($2,'CG-QA-2')`,[loadId,createLoadId]);

await db.query(`select (public.assign_load_shipment_canonical($1,$2)).id`,[loadId,shipmentId]);
let result=await db.query(`select * from public.notification_inbox_items order by created_at`);
assert.equal(result.rows.length,1,'debe avisar una vez al usuario elegible');
assert.equal(result.rows[0].recipient_admin_id,activeUser);
assert.equal(result.rows[0].source_event_type,'tracking_status_changed');
assert.equal(result.rows[0].title,'Contenedor asignado a Tracking');
assert.equal(result.rows[0].entity_type,'shipment');
assert.equal(result.rows[0].entity_id,shipmentId);
assert.equal(result.rows[0].action_payload.load_number,'CG-QA-1');

result=await db.query(`select public.notify_load_container_assignment($1,$2) as created`,[loadId,shipmentId]);
assert.equal(result.rows[0].created,0,'la misma asignación no puede duplicar el aviso');

result=await db.query(`select (public.create_load_shipment_canonical($1,'NEWC1234567',null,null,null,null,null,null)).id as id`,[createLoadId]);
const createdShipmentId=result.rows[0].id;
result=await db.query(`select * from public.notification_inbox_items where entity_id=$1`,[createdShipmentId]);
assert.equal(result.rows.length,1,'crear y asignar un contenedor también debe avisar');
assert.equal(result.rows[0].action_payload.load_number,'CG-QA-2');

result=await db.query(`
  select
    has_function_privilege('service_role','public.notify_load_container_assignment(uuid,uuid)','EXECUTE') as internal_callable,
    has_function_privilege('service_role','public.assign_load_shipment_canonical(uuid,uuid)','EXECUTE') as assign_callable,
    has_function_privilege('service_role','public.create_load_shipment_canonical(uuid,text,uuid,uuid,text,text,text,date)','EXECUTE') as create_callable
`);
assert.equal(result.rows[0].internal_callable,false,'el helper interno no debe exponerse a service_role');
assert.equal(result.rows[0].assign_callable,true);
assert.equal(result.rows[0].create_callable,true);
await db.close();

console.log('Container-to-Tracking notification contract: OK');
