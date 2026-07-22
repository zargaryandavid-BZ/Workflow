-- Designer time tracking: entries against board orders or custom tasks.

create table if not exists public.time_entries (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,

  -- What was worked on (order and/or custom task)
  order_id         uuid references public.orders (id) on delete set null,
  -- Snapshot so display survives order deletion (order_id becomes null)
  order_title      text,
  custom_task_name text,

  activity_type    text not null default 'Design'
    check (activity_type in (
      'Design',
      'Revision',
      'Prepress',
      'Proof Review',
      'Client Communication',
      'Admin',
      'Meeting',
      'Other'
    )),

  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  -- Pause/resume: when paused_at is set the clock is frozen; paused_seconds
  -- accumulates prior pause intervals so duration excludes them.
  paused_at        timestamptz,
  paused_seconds   integer not null default 0,
  notes            text,

  created_at       timestamptz not null default now(),

  constraint time_entries_has_subject check (
    order_id is not null
    or (custom_task_name is not null and btrim(custom_task_name) <> '')
    or (order_title is not null and btrim(order_title) <> '')
  ),
  constraint time_entries_ended_after_start check (
    ended_at is null or ended_at >= started_at
  ),
  constraint time_entries_paused_seconds_nonneg check (paused_seconds >= 0),
  constraint time_entries_pause_only_while_running check (
    paused_at is null or ended_at is null
  )
);

create index if not exists time_entries_user_tenant_idx
  on public.time_entries (tenant_id, user_id);

create index if not exists time_entries_order_idx
  on public.time_entries (order_id)
  where order_id is not null;

create index if not exists time_entries_running_idx
  on public.time_entries (tenant_id, user_id)
  where ended_at is null;

create index if not exists time_entries_started_at_idx
  on public.time_entries (tenant_id, user_id, started_at desc);

alter table public.time_entries enable row level security;

-- Members can read their own entries; admins can read all in the tenant
drop policy if exists "time_entries_select" on public.time_entries;
create policy "time_entries_select" on public.time_entries
  for select using (
    public.is_tenant_member(tenant_id)
    and (
      user_id = auth.uid()
      or public.is_tenant_admin(tenant_id)
    )
  );

-- Anyone can start a timer only for themselves
drop policy if exists "time_entries_insert" on public.time_entries;
create policy "time_entries_insert" on public.time_entries
  for insert with check (
    public.is_tenant_member(tenant_id)
    and user_id = auth.uid()
  );

-- Only the entry owner can update (stop / edit times / notes)
drop policy if exists "time_entries_update" on public.time_entries;
create policy "time_entries_update" on public.time_entries
  for update using (
    public.is_tenant_member(tenant_id)
    and user_id = auth.uid()
  )
  with check (
    public.is_tenant_member(tenant_id)
    and user_id = auth.uid()
  );

-- Only the entry owner can delete
drop policy if exists "time_entries_delete" on public.time_entries;
create policy "time_entries_delete" on public.time_entries
  for delete using (
    public.is_tenant_member(tenant_id)
    and user_id = auth.uid()
  );

-- Realtime for the sidebar widget across tabs
alter table public.time_entries replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'time_entries'
  ) then
    alter publication supabase_realtime add table public.time_entries;
  end if;
end $$;
