-- In-app staff notifications (e.g. designer note from sales → assigned designer).

create table if not exists public.user_notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  type        text not null default 'designer_note',
  title       text not null,
  body        text,
  order_id    uuid references public.orders (id) on delete set null,
  actor_id    uuid references auth.users (id) on delete set null,
  actor_name  text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists user_notifications_inbox_idx
  on public.user_notifications (tenant_id, user_id, created_at desc);

create index if not exists user_notifications_unread_idx
  on public.user_notifications (tenant_id, user_id)
  where read_at is null;

alter table public.user_notifications enable row level security;

-- Recipients see only their own inbox
drop policy if exists "user_notifications_select" on public.user_notifications;
create policy "user_notifications_select" on public.user_notifications
  for select using (
    public.is_tenant_member(tenant_id)
    and user_id = auth.uid()
  );

-- Any tenant member can create a notification for another member (or themselves)
drop policy if exists "user_notifications_insert" on public.user_notifications;
create policy "user_notifications_insert" on public.user_notifications
  for insert with check (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1
      from public.memberships m
      where m.tenant_id = user_notifications.tenant_id
        and m.user_id = user_notifications.user_id
    )
  );

-- Recipients may only mark their own rows read
drop policy if exists "user_notifications_update" on public.user_notifications;
create policy "user_notifications_update" on public.user_notifications
  for update using (
    public.is_tenant_member(tenant_id)
    and user_id = auth.uid()
  )
  with check (
    public.is_tenant_member(tenant_id)
    and user_id = auth.uid()
  );

drop policy if exists "user_notifications_delete" on public.user_notifications;
create policy "user_notifications_delete" on public.user_notifications
  for delete using (
    public.is_tenant_member(tenant_id)
    and user_id = auth.uid()
  );

create or replace function public.user_notifications_guard_update()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.tenant_id is distinct from old.tenant_id
     or new.type is distinct from old.type
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.order_id is distinct from old.order_id
     or new.actor_id is distinct from old.actor_id
     or new.actor_name is distinct from old.actor_name
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Not allowed to update protected notification columns';
  end if;
  return new;
end;
$$;

drop trigger if exists user_notifications_guard_update on public.user_notifications;
create trigger user_notifications_guard_update
  before update on public.user_notifications
  for each row execute function public.user_notifications_guard_update();

alter table public.user_notifications replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_notifications'
  ) then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end $$;
