-- =============================================================================
-- Customer notifications (missing info + approval via /respond/[token])
-- =============================================================================

do $$ begin
  create type public.notification_type as enum ('missing_info', 'customer_approval');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_channel as enum ('email', 'sms', 'none');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_status as enum ('pending', 'sent', 'responded', 'expired');
exception when duplicate_object then null; end $$;

create table if not exists public.job_notifications (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  order_id          uuid not null references public.orders (id) on delete cascade,
  type              public.notification_type not null,
  channel           public.notification_channel not null default 'none',
  token             uuid not null default gen_random_uuid() unique,
  token_expires_at  timestamptz,
  status            public.notification_status not null default 'pending',
  staff_note        text,
  customer_response text,
  customer_note     text,
  responded_at      timestamptz,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists job_notifications_order_idx on public.job_notifications (order_id);
create index if not exists job_notifications_tenant_idx on public.job_notifications (tenant_id);
create index if not exists job_notifications_token_idx on public.job_notifications (token);

alter table public.assets
  add column if not exists notification_id uuid references public.job_notifications (id) on delete set null;

alter table public.job_notifications enable row level security;

drop policy if exists "job_notifications_member_all" on public.job_notifications;
create policy "job_notifications_member_all" on public.job_notifications
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create or replace function public.get_notification_by_token(p_token uuid)
returns table (
  notification_id   uuid,
  type              public.notification_type,
  status            public.notification_status,
  token_expires_at  timestamptz,
  customer_note     text,
  customer_response text,
  order_title       text,
  order_description text,
  order_specs       jsonb,
  tenant_name       text,
  responded_at      timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    n.id,
    n.type,
    n.status,
    n.token_expires_at,
    n.customer_note,
    n.customer_response,
    o.title,
    o.description,
    o.specs,
    t.name,
    n.responded_at
  from public.job_notifications n
  join public.orders o on o.id = n.order_id
  join public.tenants t on t.id = n.tenant_id
  where n.token = p_token;
$$;

grant execute on function public.get_notification_by_token(uuid) to anon, authenticated;
