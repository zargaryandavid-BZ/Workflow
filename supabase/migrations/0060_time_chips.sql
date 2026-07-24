-- Configurable card time chips (system + custom), with per-column visibility.

create table if not exists public.time_chips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('system', 'custom')),
  system_key text,
  name text not null,
  icon text not null default 'clock',
  enabled boolean not null default true,
  visible_all boolean not null default true,
  visible_column_ids uuid[] not null default '{}'::uuid[],
  -- When set, stamp order.specs.time_chip_stamps[id] each time the card enters this column
  stamp_on_column_id uuid references public.board_columns (id) on delete set null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_chips_system_key_check check (
    (kind = 'system' and system_key is not null)
    or (kind = 'custom' and system_key is null)
  )
);

create unique index if not exists time_chips_tenant_system_key_uidx
  on public.time_chips (tenant_id, system_key)
  where system_key is not null;

create index if not exists time_chips_tenant_position_idx
  on public.time_chips (tenant_id, position);

alter table public.time_chips enable row level security;

drop policy if exists "time_chips_member_all" on public.time_chips;
create policy "time_chips_member_all" on public.time_chips
  for all using (
    tenant_id in (
      select m.tenant_id from public.memberships m where m.user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select m.tenant_id from public.memberships m where m.user_id = auth.uid()
    )
  );
