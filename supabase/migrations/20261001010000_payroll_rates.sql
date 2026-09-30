alter table public.tenants
  add column if not exists payroll_rates jsonb not null default '{}'::jsonb;
