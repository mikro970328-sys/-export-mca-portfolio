-- Legacy column shape checked against information_schema on 2026-09-09.
-- No financial functions, calculated views or business rows are substituted.
alter table public.admin_users add column is_active boolean not null default true;
alter table public.payments alter column amount type numeric(14,2);
