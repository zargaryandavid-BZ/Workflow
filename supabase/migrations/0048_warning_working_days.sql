-- Which weekdays count toward stale-card warning thresholds (per tenant).
-- Values use JS Date.getDay(): 0 = Sunday … 6 = Saturday.
-- Default Mon–Fri (1–5), matching previous hardcoded behaviour.

alter table public.tenants
  add column if not exists warning_working_days smallint[] not null
    default array[1, 2, 3, 4, 5]::smallint[];

alter table public.tenants
  drop constraint if exists tenants_warning_working_days_valid;

alter table public.tenants
  add constraint tenants_warning_working_days_valid
  check (
    cardinality(warning_working_days) >= 1
    and warning_working_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  );
