-- P15 · B9.1 post-migration assertions.
-- Read-only assertions; the explicit blocked-write probe is executed separately under ROLE authenticated.

do $$
declare
  v_count bigint;
  v_search_path text;
begin
  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relkind in ('r','p','v','m','f')
    and (
      has_table_privilege('anon',c.oid,'SELECT') or
      has_table_privilege('anon',c.oid,'INSERT') or
      has_table_privilege('anon',c.oid,'UPDATE') or
      has_table_privilege('anon',c.oid,'DELETE') or
      has_table_privilege('authenticated',c.oid,'SELECT') or
      has_table_privilege('authenticated',c.oid,'INSERT') or
      has_table_privilege('authenticated',c.oid,'UPDATE') or
      has_table_privilege('authenticated',c.oid,'DELETE')
    );
  if v_count<>0 then raise exception 'P15_TABLE_PRIVILEGES_REMAIN:%',v_count; end if;

  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='S'
    and (
      has_sequence_privilege('anon',c.oid,'USAGE') or
      has_sequence_privilege('anon',c.oid,'SELECT') or
      has_sequence_privilege('anon',c.oid,'UPDATE') or
      has_sequence_privilege('authenticated',c.oid,'USAGE') or
      has_sequence_privilege('authenticated',c.oid,'SELECT') or
      has_sequence_privilege('authenticated',c.oid,'UPDATE')
    );
  if v_count<>0 then raise exception 'P15_SEQUENCE_PRIVILEGES_REMAIN:%',v_count; end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'));
  if v_count<>0 then raise exception 'P15_FUNCTION_PRIVILEGES_REMAIN:%',v_count; end if;

  select count(*) into v_count
  from pg_policies
  where schemaname='public'
    and policyname in (
      'authenticated_access_documents','authenticated_access_expenses','authenticated_access_importers',
      'authenticated_access_operation_items','authenticated_access_operations',
      'authenticated_access_products','authenticated_access_suppliers'
    );
  if v_count<>0 then raise exception 'P15_LEGACY_POLICIES_REMAIN:%',v_count; end if;

  select count(*) into v_count
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) x
  where d.defaclrole=(select oid from pg_roles where rolname='postgres')
    and d.defaclnamespace=(select oid from pg_namespace where nspname='public')
    and d.defaclobjtype in ('r','S','f')
    and (x).grantee in (
      0,
      (select oid from pg_roles where rolname='anon'),
      (select oid from pg_roles where rolname='authenticated')
    );
  if v_count<>0 then raise exception 'P15_POSTGRES_DEFAULT_ACL_EXPOSURE:%',v_count; end if;

  select array_to_string(p.proconfig,',') into v_search_path
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='set_commercial_publications_updated_at'
    and oidvectortypes(p.proargtypes)=''
  limit 1;
  if coalesce(v_search_path,'') not like '%search_path=public, pg_temp%' then
    raise exception 'P15_SEARCH_PATH_NOT_FIXED:%',coalesce(v_search_path,'NULL');
  end if;

  if not has_table_privilege('service_role','public.suppliers','SELECT')
     or not has_table_privilege('service_role','public.suppliers','INSERT') then
    raise exception 'P15_SERVICE_ROLE_SUPPLIERS_BROKEN';
  end if;
end $$;

select
  'p15_database_privilege_hardening_passed' as result,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')) as public_tables_checked,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') as public_functions_checked;
