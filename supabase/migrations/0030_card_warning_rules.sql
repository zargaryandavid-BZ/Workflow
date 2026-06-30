-- Stale Card Warnings
-- Tracks when a card last moved columns, and stores per-tenant warning rules.

-- 1. Add last_moved_at to orders
alter table public.orders
  add column if not exists last_moved_at timestamptz;

-- Backfill existing rows so they don't immediately trigger warnings
update public.orders
  set last_moved_at = updated_at
  where last_moved_at is null;

-- 2. Card warning rules table
create table if not exists public.card_warning_rules (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  name             text not null,
  threshold_days   integer not null default 3
    check (threshold_days >= 1),
  color            text not null default 'amber'
    check (color in ('amber', 'orange', 'red', 'purple', 'blue', 'pink')),
  apply_to_columns text[] not null default '{}',
  enabled          boolean not null default true,
  position         integer not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists card_warning_rules_tenant_idx
  on public.card_warning_rules(tenant_id, position);

alter table public.card_warning_rules enable row level security;

drop policy if exists "card_warning_rules_select_member" on public.card_warning_rules;
drop policy if exists "card_warning_rules_admin_write"   on public.card_warning_rules;

create policy "card_warning_rules_select_member" on public.card_warning_rules
  for select using (public.is_tenant_member(tenant_id));

create policy "card_warning_rules_admin_write" on public.card_warning_rules
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
