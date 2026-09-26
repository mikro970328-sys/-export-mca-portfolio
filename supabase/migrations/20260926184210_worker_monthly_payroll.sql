-- Pagos mensuales del equipo. Solo las filas vigentes se incluyen en la
-- rentabilidad; al corregir una fila se conserva su reemplazo en auditoría.
create table public.worker_monthly_payroll (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete restrict,
  period_start date not null,
  salary_amount numeric(14,2) not null default 0,
  tips_amount numeric(14,2) not null default 0,
  currency text not null default 'USD',
  status text not null default 'posted',
  notes text,
  created_by uuid references public.admin_users(id) on delete set null,
  updated_by uuid references public.admin_users(id) on delete set null,
  voided_by uuid references public.admin_users(id) on delete set null,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_monthly_payroll_month_start_check check (extract(day from period_start) = 1),
  constraint worker_monthly_payroll_salary_check check (salary_amount >= 0),
  constraint worker_monthly_payroll_tips_check check (tips_amount >= 0),
  constraint worker_monthly_payroll_positive_total_check check (salary_amount + tips_amount > 0),
  constraint worker_monthly_payroll_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint worker_monthly_payroll_status_check check (status in ('posted','void')),
  constraint worker_monthly_payroll_void_state_check check (
    (status = 'posted' and voided_at is null and voided_by is null)
    or (status = 'void' and voided_at is not null and voided_by is not null)
  )
);

alter table public.worker_monthly_payroll enable row level security;

create unique index worker_monthly_payroll_active_worker_period_currency_uidx
  on public.worker_monthly_payroll(worker_id,period_start,currency)
  where status = 'posted';

create index worker_monthly_payroll_period_status_idx
  on public.worker_monthly_payroll(period_start desc,status);

create index worker_monthly_payroll_worker_period_idx
  on public.worker_monthly_payroll(worker_id,period_start desc);

create trigger worker_monthly_payroll_set_updated_at
before update on public.worker_monthly_payroll
for each row execute function public.set_erp_updated_at();

comment on table public.worker_monthly_payroll is
  'Monthly salary and tips by worker. Exposed only through finance-authorized ERP APIs.';
comment on column public.worker_monthly_payroll.period_start is
  'First day of the month to which salary and tips belong.';
