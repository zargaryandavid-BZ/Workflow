-- Die usage + history.
--  • Status: Working / Out of order ("problem" becomes "out_of_order").
--  • Usage: max uses, use count, last used, who has the die right now.
--  • on_order: a die ordered from a manufacturer stays off the Dies tab
--    until its request is marked "Die received".
--  • die_events: everything that happened to a die (history page).

-- Safe in either order with 20261105225910_die_shop_status.sql (that file
-- sorts after this one): create the status columns here if they're missing.
alter table public.dies
  add column if not exists shop_status text not null default 'working';
alter table public.dies
  add column if not exists ordered_at timestamptz;
update public.dies set ordered_at = created_at where ordered_at is null;
alter table public.dies alter column ordered_at set default now();
alter table public.dies alter column ordered_at set not null;

alter table public.dies drop constraint if exists dies_shop_status_check;
update public.dies set shop_status = 'out_of_order' where shop_status = 'problem';

alter table public.dies drop constraint if exists dies_shop_status_check;
alter table public.dies
  add constraint dies_shop_status_check
  check (shop_status in ('working', 'out_of_order'));

alter table public.dies
  add column if not exists max_uses integer check (max_uses is null or max_uses > 0),
  add column if not exists use_count integer not null default 0,
  add column if not exists last_used_at timestamptz,
  add column if not exists checked_out_by uuid references auth.users (id) on delete set null,
  add column if not exists checked_out_by_name text,
  add column if not exists checked_out_at timestamptz,
  add column if not exists on_order boolean not null default false;

create table if not exists public.die_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  die_id uuid not null references public.dies (id) on delete cascade,
  kind text not null check (kind in (
    'added', 'ordered', 'received', 'used', 'returned',
    'status', 'reorder', 'edited', 'deleted', 'reminded'
  )),
  actor_id uuid references auth.users (id) on delete set null,
  actor_name text,
  note text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists die_events_die_idx on public.die_events (die_id, created_at desc);
create index if not exists die_events_tenant_idx on public.die_events (tenant_id);

alter table public.die_events enable row level security;

drop policy if exists "die_events_member_all" on public.die_events;
create policy "die_events_member_all" on public.die_events
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Existing dies: one with quote requests but none received yet is still on order.
-- Only a die created for its first request (ordered as a new die, within a
-- few minutes of that request) and never received is still on order.
update public.dies d
  set on_order = true
  where exists (
      select 1 from public.die_requests r
      where r.die_id = d.id
        and r.sent_at <= d.created_at + interval '10 minutes'
    )
    and not exists (
      select 1 from public.die_requests r
      where r.die_id = d.id and r.status = 'received'
    );
