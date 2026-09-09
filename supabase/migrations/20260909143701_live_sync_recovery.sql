-- Only publish committed data changes, not empty reconciliation statements.
-- Preserve the existing module mapping, private owner and table privileges.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function private.bump_erp_change_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_scope text := nullif(tg_argv[0], '');
  v_changed boolean := false;
begin
  if v_scope is null or v_scope <> all (array[
    'products','suppliers','purchases','warehouse','inventory','loads','sales',
    'clients','shipments','publications','invoices','payables','costs','tasks',
    'notifications','account','workers'
  ]) then
    raise exception 'ERP_CHANGE_SCOPE_INVALID';
  end if;

  if tg_op = 'INSERT' then
    select exists(select 1 from erp_change_new) into v_changed;
  elsif tg_op = 'DELETE' then
    select exists(select 1 from erp_change_old) into v_changed;
  elsif tg_op = 'UPDATE' then
    -- UPDATE has equally many old/new rows. Compare multisets, so a no-op
    -- is silent even on tables with composite keys, nullable or JSON fields.
    select exists(
      select to_jsonb(n) from erp_change_new n
      except all
      select to_jsonb(o) from erp_change_old o
    ) into v_changed;
  else
    raise exception 'ERP_CHANGE_OPERATION_INVALID';
  end if;

  if not v_changed then return null; end if;

  insert into public.erp_change_state as current_state(scope, version, changed_at)
  values (v_scope, 1, clock_timestamp())
  on conflict (scope) do update
  set version = current_state.version + 1,
      changed_at = excluded.changed_at;
  return null;
end;
$$;

revoke all on function private.bump_erp_change_state() from public, anon, authenticated, service_role;

do $$
declare
  mapping record;
  v_count integer := 0;
begin
  -- This is a backend cursor, not a user-visible change. Its timestamp moves
  -- on every reconciliation, even when all deliveries were deduplicated.
  if to_regclass('public.web_push_runtime_state') is not null then
    drop trigger if exists erp_change_state_bump on public.web_push_runtime_state;
    drop trigger if exists erp_change_state_insert on public.web_push_runtime_state;
    drop trigger if exists erp_change_state_update on public.web_push_runtime_state;
    drop trigger if exists erp_change_state_delete on public.web_push_runtime_state;
  end if;
  -- Transition relations require one event per trigger. Replace only this
  -- feature's triggers; never alter business, audit or validation triggers.
  for mapping in
    select distinct c.oid, n.nspname as schema_name, c.relname as table_name,
      convert_from(substring(t.tgargs from 1 for length(t.tgargs)-1), 'UTF8') as scope
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not t.tgisinternal and t.tgnargs = 1
      and t.tgfoid = 'private.bump_erp_change_state()'::regprocedure
      and t.tgname in (
        'erp_change_state_bump', 'erp_change_state_insert',
        'erp_change_state_update', 'erp_change_state_delete'
      )
    order by c.oid
  loop
    if not exists(select 1 from public.erp_change_state where scope = mapping.scope) then
      raise exception 'ERP_CHANGE_SCOPE_INVALID';
    end if;
    execute format('drop trigger if exists erp_change_state_bump on %I.%I', mapping.schema_name, mapping.table_name);
    execute format('drop trigger if exists erp_change_state_insert on %I.%I', mapping.schema_name, mapping.table_name);
    execute format('drop trigger if exists erp_change_state_update on %I.%I', mapping.schema_name, mapping.table_name);
    execute format('drop trigger if exists erp_change_state_delete on %I.%I', mapping.schema_name, mapping.table_name);
    execute format(
      'create trigger erp_change_state_insert after insert on %I.%I referencing new table as erp_change_new for each statement execute function private.bump_erp_change_state(%L)',
      mapping.schema_name, mapping.table_name, mapping.scope
    );
    execute format(
      'create trigger erp_change_state_update after update on %I.%I referencing old table as erp_change_old new table as erp_change_new for each statement execute function private.bump_erp_change_state(%L)',
      mapping.schema_name, mapping.table_name, mapping.scope
    );
    execute format(
      'create trigger erp_change_state_delete after delete on %I.%I referencing old table as erp_change_old for each statement execute function private.bump_erp_change_state(%L)',
      mapping.schema_name, mapping.table_name, mapping.scope
    );
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'ERP_CHANGE_TRIGGERS_NOT_FOUND'; end if;
end;
$$;
