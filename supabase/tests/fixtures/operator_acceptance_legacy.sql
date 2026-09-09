-- Disposable QA database only. Complete the legacy admin/audit columns needed
-- by P3/P17, matching the live schema inspected on 2026-09-09. No account seed
-- or password from the historical multi-admin migration is copied or executed.
alter table public.clients add column mipyme_name text;
grant select on public.clients,public.products,public.suppliers,public.shipments,
  public.importers,public.client_importers,public.operations to service_role;
-- Supabase's historical table grants predate this slice. These privileges were
-- inspected on the live schema; restore them only in the disposable QA fixture.
grant select,insert,update,delete on public.warehouses,public.warehouse_receipts,
  public.warehouse_receipt_items,public.purchase_orders,public.purchase_order_items,
  public.purchase_receipt_allocations to service_role;
grant select on public.purchase_order_progress,public.purchase_order_item_progress to service_role;
grant usage on sequence public.warehouse_receipt_number_seq to service_role;
alter table public.admin_users
  alter column username set not null,
  alter column role set not null,
  alter column role set default 'admin',
  add constraint admin_users_role_check check (role in ('master_admin','admin')),
  add column full_name text not null,
  add column username_normalized text generated always as (lower(trim(username))) stored,
  add column password_salt text not null,
  add column password_hash text not null,
  add column failed_attempts integer not null default 0,
  add column locked_until timestamptz,
  add column last_login_at timestamptz,
  add column password_changed_at timestamptz not null default now(),
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add column created_by uuid references public.admin_users(id) on delete set null;
create unique index admin_users_username_unique on public.admin_users(username_normalized);
alter table public.admin_users enable row level security;
grant select on public.admin_users to service_role;
alter table public.audit_log
  alter column action set not null,
  alter column entity_type set not null,
  alter column created_at set not null,
  add column actor_admin_id uuid references public.admin_users(id) on delete set null,
  add column actor_username text;
-- Same legacy timestamp trigger body as 20260728_multi_admin_auth.sql.
create function public.touch_admin_users_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger admin_users_touch_updated_at before update on public.admin_users
for each row execute function public.touch_admin_users_updated_at();
