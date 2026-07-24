-- ============================================================
-- Print Production Manager - full setup (run once in Supabase SQL Editor)
-- Combines: 0001_schema.sql, 0002_functions.sql, 0003_rls.sql
-- ============================================================

-- =============================================================================
-- Print Production Manager - core schema
-- =============================================================================

create extension if not exists "pgcrypto";

-- Tenants (organizations / branches / separate print houses) -----------------
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- Profiles mirror auth.users -------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Memberships link users to tenants with a role ------------------------------
create type public.member_role as enum ('admin', 'member');

create table if not exists public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);
create index if not exists memberships_tenant_idx on public.memberships (tenant_id);

-- Board columns (pipeline stages) --------------------------------------------
create type public.column_kind as enum ('normal', 'exception', 'approval', 'done');

create table if not exists public.board_columns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  position int not null default 0,
  kind public.column_kind not null default 'normal',
  created_at timestamptz not null default now()
);
create index if not exists board_columns_tenant_idx on public.board_columns (tenant_id);

-- Customers ------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  email text,
  phone text,
  company text,
  preferred_channel text not null default 'sms'
    check (preferred_channel in ('sms', 'email')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_tenant_idx on public.customers (tenant_id);
create unique index if not exists customers_tenant_email_unique
  on public.customers (tenant_id, email) where email is not null;
create unique index if not exists customers_tenant_phone_unique
  on public.customers (tenant_id, phone) where phone is not null;

-- Orders (print jobs / cards) ------------------------------------------------
create type public.order_priority as enum ('low', 'normal', 'high', 'urgent');

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  column_id uuid not null references public.board_columns (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete set null,
  title text not null,
  description text,
  specs jsonb not null default '{}'::jsonb,
  priority public.order_priority not null default 'normal',
  due_date date,
  position double precision not null default 1000,
  created_by uuid references auth.users (id) on delete set null,
  -- Webhook payload `source` key; null for cards created manually in the app.
  webhook_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_tenant_idx on public.orders (tenant_id);
create index if not exists orders_column_idx on public.orders (column_id);

-- Custom fields --------------------------------------------------------------
create type public.custom_field_type as enum ('text', 'number', 'select', 'date', 'checkbox');

create table if not exists public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  field_type public.custom_field_type not null default 'text',
  options jsonb not null default '[]'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists custom_fields_tenant_idx on public.custom_fields (tenant_id);

create table if not exists public.custom_field_values (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  custom_field_id uuid not null references public.custom_fields (id) on delete cascade,
  value jsonb,
  unique (order_id, custom_field_id)
);
create index if not exists cfv_order_idx on public.custom_field_values (order_id);

-- Assets (file metadata; bytes live in Storage) ------------------------------
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size bigint,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists assets_order_idx on public.assets (order_id);

-- Approvals (customer sign-off, token addressable) ---------------------------
create type public.approval_status as enum ('pending', 'approved', 'rejected');

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  status public.approval_status not null default 'pending',
  token uuid not null default gen_random_uuid() unique,
  customer_email text,
  comment text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists approvals_order_idx on public.approvals (order_id);
create index if not exists approvals_token_idx on public.approvals (token);

-- Automation rules -----------------------------------------------------------
create type public.automation_trigger as enum ('on_enter_column', 'on_approval_result', 'on_job_created');

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  trigger public.automation_trigger not null,
  from_column uuid references public.board_columns (id) on delete cascade,
  to_column uuid references public.board_columns (id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists automation_rules_tenant_idx on public.automation_rules (tenant_id);

-- Activity log ---------------------------------------------------------------
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  actor uuid references auth.users (id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_log_order_idx on public.activity_log (order_id);
create index if not exists activity_log_tenant_idx on public.activity_log (tenant_id);

-- Keep orders.updated_at fresh ----------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- E.164-style phone normalization for customer dedup (see migration 0015).
create or replace function public.normalize_customer_phone(raw text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  if raw is null or trim(raw) = '' then
    return null;
  end if;

  digits := regexp_replace(raw, '[^0-9]', '', 'g');

  if length(digits) = 10 then
    return '+1' || digits;
  end if;

  if length(digits) = 11 and left(digits, 1) = '1' then
    return '+' || digits;
  end if;

  if left(trim(raw), 1) = '+' then
    return '+' || digits;
  end if;

  return '+' || digits;
end;
$$;

-- =============================================================================
-- Helper functions, tenant provisioning, profile sync, and public approval RPCs
-- =============================================================================

-- Membership check used by RLS policies. SECURITY DEFINER so it can read
-- memberships without recursing through the table's own RLS policies.
create or replace function public.is_tenant_member(p_tenant uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_tenant_admin(p_tenant uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant
      and m.user_id = auth.uid()
      and m.role = 'admin'
  );
$$;

-- Auto-create a profile row when a new auth user signs up --------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Create a tenant, seed default columns, and make the caller an admin -------
create or replace function public.create_tenant(p_name text, p_slug text)
returns public.tenants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.tenants (name, slug)
  values (p_name, p_slug)
  returning * into v_tenant;

  insert into public.memberships (user_id, tenant_id, role)
  values (v_uid, v_tenant.id, 'admin');

  insert into public.board_columns (tenant_id, name, position, kind) values
    (v_tenant.id, 'START (Order Created)', 0, 'normal'),
    (v_tenant.id, 'In Progress',          1, 'normal'),
    (v_tenant.id, 'Missing Info',         2, 'exception'),
    (v_tenant.id, 'Returning Tickets',    3, 'exception'),
    (v_tenant.id, 'Customer Approval',    4, 'approval'),
    (v_tenant.id, 'Done (Ready for Prod)',5, 'done');

  -- Seed default automations: approve -> Done, reject -> Returning Tickets
  insert into public.automation_rules (tenant_id, trigger, from_column, to_column, config)
  select
    v_tenant.id,
    'on_approval_result',
    (select id from public.board_columns where tenant_id = v_tenant.id and kind = 'approval'),
    (select id from public.board_columns where tenant_id = v_tenant.id and kind = 'done'),
    '{"result": "approved"}'::jsonb;

  insert into public.automation_rules (tenant_id, trigger, from_column, to_column, config)
  select
    v_tenant.id,
    'on_approval_result',
    (select id from public.board_columns where tenant_id = v_tenant.id and kind = 'approval'),
    (select id from public.board_columns where tenant_id = v_tenant.id and name = 'Returning Tickets'),
    '{"result": "rejected"}'::jsonb;

  return v_tenant;
end;
$$;

-- Public, token-addressable view of an approval for the customer page --------
create or replace function public.get_approval_by_token(p_token uuid)
returns table (
  approval_id       uuid,
  order_id          uuid,
  status            public.approval_status,
  order_title       text,
  order_description text,
  order_specs       jsonb,
  order_fields      jsonb,
  tenant_name       text,
  comment           text,
  decided_at        timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id,
    o.id,
    a.status,
    o.title,
    o.description,
    o.specs,
    (
      select coalesce(jsonb_object_agg(cf.name, cfv.value), '{}'::jsonb)
      from public.custom_field_values cfv
      join public.custom_fields cf on cf.id = cfv.custom_field_id
      where cfv.order_id = o.id
    ) as order_fields,
    t.name,
    a.comment,
    a.decided_at
  from public.approvals a
  join public.orders o on o.id = a.order_id
  join public.tenants t on t.id = a.tenant_id
  where a.token = p_token;
$$;

grant execute on function public.get_approval_by_token(uuid) to anon, authenticated;
grant execute on function public.create_tenant(text, text) to authenticated;
grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.is_tenant_admin(uuid) to authenticated;

-- =============================================================================
-- Row-Level Security: tenant isolation on every table
-- =============================================================================

alter table public.tenants            enable row level security;
alter table public.profiles           enable row level security;
alter table public.memberships        enable row level security;
alter table public.board_columns      enable row level security;
alter table public.customers          enable row level security;
alter table public.orders             enable row level security;
alter table public.custom_fields      enable row level security;
alter table public.custom_field_values enable row level security;
alter table public.assets             enable row level security;
alter table public.approvals          enable row level security;
alter table public.automation_rules   enable row level security;
alter table public.activity_log       enable row level security;

-- Realtime + RLS: FULL replica identity so UPDATE payloads reach subscribers.
alter table public.orders replica identity full;
alter table public.job_notifications replica identity full;

-- Board subscribes to orders + job_notifications via postgres_changes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'job_notifications'
  ) then
    alter publication supabase_realtime add table public.job_notifications;
  end if;
end $$;

-- Tenants --------------------------------------------------------------------
create policy "tenants_select_member" on public.tenants
  for select using (public.is_tenant_member(id));
create policy "tenants_update_admin" on public.tenants
  for update using (public.is_tenant_admin(id));

-- Profiles -------------------------------------------------------------------
create policy "profiles_select_self_or_teammate" on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from public.memberships me
      join public.memberships them on them.tenant_id = me.tenant_id
      where me.user_id = auth.uid() and them.user_id = profiles.id
    )
  );
create policy "profiles_update_self" on public.profiles
  for update using (id = auth.uid());
create policy "profiles_insert_self" on public.profiles
  for insert with check (id = auth.uid());

-- Memberships ----------------------------------------------------------------
create policy "memberships_select_member" on public.memberships
  for select using (public.is_tenant_member(tenant_id));
create policy "memberships_admin_write" on public.memberships
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- Board columns --------------------------------------------------------------
create policy "columns_select_member" on public.board_columns
  for select using (public.is_tenant_member(tenant_id));
create policy "columns_admin_write" on public.board_columns
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- Customers ------------------------------------------------------------------
create policy "customers_member_all" on public.customers
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Orders ---------------------------------------------------------------------
create policy "orders_member_all" on public.orders
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Custom fields (definitions: admins manage, members read) -------------------
create policy "custom_fields_select_member" on public.custom_fields
  for select using (public.is_tenant_member(tenant_id));
create policy "custom_fields_admin_write" on public.custom_fields
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- Custom field values (any member of the order's tenant) ---------------------
create policy "cfv_member_all" on public.custom_field_values
  for all using (
    exists (
      select 1 from public.orders o
      where o.id = custom_field_values.order_id
        and public.is_tenant_member(o.tenant_id)
    )
  )
  with check (
    exists (
      select 1 from public.orders o
      where o.id = custom_field_values.order_id
        and public.is_tenant_member(o.tenant_id)
    )
  );

-- Assets ---------------------------------------------------------------------
create policy "assets_member_all" on public.assets
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Approvals (members manage; public read goes through the SECURITY DEFINER RPC)
create policy "approvals_member_all" on public.approvals
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Automation rules (admins manage, members read) -----------------------------
create policy "automation_select_member" on public.automation_rules
  for select using (public.is_tenant_member(tenant_id));
create policy "automation_admin_write" on public.automation_rules
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- Activity log (members read; inserts via members / service role) ------------
create policy "activity_select_member" on public.activity_log
  for select using (public.is_tenant_member(tenant_id));
create policy "activity_insert_member" on public.activity_log
  for insert with check (public.is_tenant_member(tenant_id));

-- =============================================================================
-- Storage bucket + policies for order assets
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('order-assets', 'order-assets', false)
on conflict (id) do nothing;

-- Path convention: {tenant_id}/{order_id}/{filename}
-- The first path segment is the tenant id; membership is checked against it.
create policy "order_assets_member_read" on storage.objects
  for select using (
    bucket_id = 'order-assets'
    and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );
create policy "order_assets_member_insert" on storage.objects
  for insert with check (
    bucket_id = 'order-assets'
    and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );
create policy "order_assets_member_delete" on storage.objects
  for delete using (
    bucket_id = 'order-assets'
    and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );


-- =============================================================================
-- Board column metadata: custom color + picture, and an image storage bucket
-- =============================================================================

alter table public.board_columns
  add column if not exists color text,
  add column if not exists image_url text;

-- Public bucket for column header images. Path convention: {tenant_id}/{file}
insert into storage.buckets (id, name, public)
values ('column-images', 'column-images', true)
on conflict (id) do nothing;

drop policy if exists "column_images_member_insert" on storage.objects;
drop policy if exists "column_images_member_delete" on storage.objects;

create policy "column_images_member_insert" on storage.objects
  for insert with check (
    bucket_id = 'column-images'
    and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );

create policy "column_images_member_delete" on storage.objects
  for delete using (
    bucket_id = 'column-images'
    and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );


-- =============================================================================
-- Role-based board permissions
--   Adds granular team roles and per-column drop-in / drop-out controls.
--   NOTE: `alter type ... add value` cannot run inside a transaction with the
--   array columns below in some Postgres versions. If the SQL editor complains,
--   run the three `alter type` statements first on their own, then the rest.
-- =============================================================================

alter type public.member_role add value if not exists 'preprod_owner';
alter type public.member_role add value if not exists 'designer';
alter type public.member_role add value if not exists 'account_manager';

-- Per-column drop permissions.
--   NULL            => unrestricted (any team member may move the order)
--   '{}' (empty)    => admins only
--   '{role,...}'    => listed roles (plus admins) may move the order
-- drop_in_roles  : who may move an order INTO this column
-- drop_out_roles : who may move an order OUT OF this column
alter table public.board_columns
  add column if not exists drop_in_roles public.member_role[],
  add column if not exists drop_out_roles public.member_role[];


-- =============================================================================
-- Custom fields: per-field "required" flag
-- =============================================================================

alter table public.custom_fields
  add column if not exists required boolean not null default false;


-- =============================================================================
-- Webhook source on orders (payload `source` key; null = manual card)
-- =============================================================================

alter table public.orders
  add column if not exists webhook_source text;


-- =============================================================================
-- Customer notifications (column-trigger automation)
--   When a job enters a configured column, staff can notify the customer via
--   email/SMS with a tokenized link. The customer responds without logging in
--   and their response moves the card. Notification triggers are themselves
--   stored as on_enter_column automation rules with config.action = 'notify'
--   so admins can enable/disable them from the Automations page.
-- =============================================================================

do $$ begin
  create type public.notification_type as enum ('missing_info', 'customer_approval');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_channel as enum ('email', 'sms', 'none', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_status as enum ('pending', 'sent', 'responded', 'expired');
exception when duplicate_object then null; end $$;

create table if not exists public.job_notifications (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  order_id         uuid not null references public.orders (id) on delete cascade,
  type             public.notification_type not null,
  channel          public.notification_channel not null default 'none',
  token            uuid not null default gen_random_uuid() unique,
  token_expires_at timestamptz,
  status           public.notification_status not null default 'pending',
  staff_note       text,                 -- optional note staff added when sending
  customer_response text,                -- 'approved' | 'changes_requested' | 'info_submitted'
  customer_note    text,                 -- free text the customer left back
  responded_at     timestamptz,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists job_notifications_order_idx on public.job_notifications (order_id);
create index if not exists job_notifications_tenant_idx on public.job_notifications (tenant_id);
create index if not exists job_notifications_token_idx on public.job_notifications (token);

-- Link customer-uploaded files to the notification that requested them.
alter table public.assets
  add column if not exists notification_id uuid references public.job_notifications (id) on delete set null;

alter table public.assets
  add column if not exists sku_key text;

create index if not exists assets_order_sku_idx
  on public.assets (order_id, sku_key)
  where sku_key is not null;

alter table public.job_notifications enable row level security;

drop policy if exists "job_notifications_member_all" on public.job_notifications;
create policy "job_notifications_member_all" on public.job_notifications
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Public, token-addressable view of a notification for the customer page.
-- SECURITY DEFINER so the anonymous customer page can read just this row.
drop function if exists public.get_notification_by_token(uuid);

create or replace function public.get_notification_by_token(p_token uuid)
returns table (
  notification_id   uuid,
  order_id          uuid,
  type              public.notification_type,
  status            public.notification_status,
  token_expires_at  timestamptz,
  staff_note        text,
  customer_note     text,
  customer_response text,
  order_title       text,
  order_description text,
  order_specs       jsonb,
  order_fields      jsonb,
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
    o.id,
    n.type,
    n.status,
    n.token_expires_at,
    n.staff_note,
    n.customer_note,
    n.customer_response,
    o.title,
    o.description,
    o.specs,
    (
      select coalesce(jsonb_object_agg(cf.name, cfv.value), '{}'::jsonb)
      from public.custom_field_values cfv
      join public.custom_fields cf on cf.id = cfv.custom_field_id
      where cfv.order_id = o.id
    ) as order_fields,
    t.name,
    n.responded_at
  from public.job_notifications n
  join public.orders o on o.id = n.order_id
  join public.tenants t on t.id = n.tenant_id
  where n.token = p_token;
$$;

grant execute on function public.get_notification_by_token(uuid) to anon, authenticated;

-- =============================================================================
-- Shipping requests (client pickup / delivery portal)
-- =============================================================================

create table if not exists public.shipping_requests (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  order_id         uuid not null references public.orders (id) on delete cascade,
  token            uuid not null unique default gen_random_uuid(),
  boxes            jsonb not null default '[]'::jsonb,
  status           text not null default 'pending'
                     check (status in ('pending', 'client_responded')),
  client_choice    text check (client_choice is null or client_choice in ('pickup', 'delivery')),
  fedex_selection  jsonb,
  delivery_address jsonb,
  sent_at          timestamptz,
  responded_at     timestamptz,
  expires_at       timestamptz default (now() + interval '7 days'),
  created_at       timestamptz not null default now()
);

create index if not exists shipping_requests_order_idx on public.shipping_requests (order_id);
create index if not exists shipping_requests_tenant_idx on public.shipping_requests (tenant_id);
create index if not exists shipping_requests_token_idx on public.shipping_requests (token);

alter table public.shipping_requests enable row level security;

drop policy if exists "shipping_requests_member_all" on public.shipping_requests;
create policy "shipping_requests_member_all" on public.shipping_requests
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Must DROP first: CREATE OR REPLACE cannot change OUT/return row type (42P13).
drop function if exists public.get_shipping_request_by_token(uuid);

create function public.get_shipping_request_by_token(p_token uuid)
returns table (
  shipping_request_id uuid,
  status              text,
  boxes               jsonb,
  client_choice       text,
  fedex_selection     jsonb,
  delivery_address    jsonb,
  expires_at          timestamptz,
  responded_at        timestamptz,
  order_id            uuid,
  order_title         text,
  order_fields        jsonb,
  tenant_name         text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    sr.id,
    sr.status,
    sr.boxes,
    sr.client_choice,
    sr.fedex_selection,
    sr.delivery_address,
    sr.expires_at,
    sr.responded_at,
    o.id,
    o.title,
    (
      select coalesce(jsonb_object_agg(cf.name, cfv.value), '{}'::jsonb)
      from public.custom_field_values cfv
      join public.custom_fields cf on cf.id = cfv.custom_field_id
      where cfv.order_id = o.id
    ) as order_fields,
    t.name
  from public.shipping_requests sr
  join public.orders o on o.id = sr.order_id
  join public.tenants t on t.id = sr.tenant_id
  where sr.token = p_token;
$$;

grant execute on function public.get_shipping_request_by_token(uuid) to anon, authenticated;

-- =============================================================================
-- Shipping settings + payment columns (migration 0046)
-- =============================================================================

create table if not exists public.shipping_settings (
  tenant_id              uuid primary key references public.tenants (id) on delete cascade,
  fedex_api_key          text,
  fedex_secret_key       text,
  fedex_account_number   text,
  fedex_sandbox          boolean not null default true,
  shipper_street         text,
  shipper_city           text,
  shipper_state          text,
  shipper_zip            text,
  shipper_country        text not null default 'US',
  pickup_hours_note      text,
  payment_enabled        boolean not null default false,
  stripe_publishable_key text,
  stripe_secret_key      text,
  stripe_webhook_secret  text,
  markup_fixed_cents     integer not null default 0 check (markup_fixed_cents >= 0),
  markup_percent         numeric(6, 2) not null default 0 check (markup_percent >= 0),
  updated_at             timestamptz not null default now()
);

alter table public.shipping_settings enable row level security;

drop policy if exists "shipping_settings_member_all" on public.shipping_settings;
create policy "shipping_settings_member_all" on public.shipping_settings
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

alter table public.shipping_requests
  add column if not exists checkout_session_id text,
  add column if not exists payment_intent_id text,
  add column if not exists payment_status text,
  add column if not exists payment_amount integer,
  add column if not exists payment_currency text default 'usd';

alter table public.shipping_requests drop constraint if exists shipping_requests_payment_status_check;
alter table public.shipping_requests add constraint shipping_requests_payment_status_check
  check (payment_status is null or payment_status in ('pending', 'succeeded', 'failed'));

alter table public.shipping_requests drop constraint if exists shipping_requests_status_check;
alter table public.shipping_requests add constraint shipping_requests_status_check
  check (status in ('pending', 'payment_pending', 'client_responded'));

drop function if exists public.get_shipping_request_by_token(uuid);

create function public.get_shipping_request_by_token(p_token uuid)
returns table (
  shipping_request_id uuid,
  status              text,
  boxes               jsonb,
  client_choice       text,
  fedex_selection     jsonb,
  delivery_address    jsonb,
  expires_at          timestamptz,
  responded_at        timestamptz,
  order_id            uuid,
  order_title         text,
  order_fields        jsonb,
  tenant_name         text,
  tenant_id           uuid,
  payment_enabled     boolean,
  payment_status      text,
  payment_amount      integer,
  payment_currency    text,
  shipper_street      text,
  shipper_city        text,
  shipper_state       text,
  shipper_zip         text,
  shipper_country     text,
  pickup_hours_note   text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    sr.id,
    sr.status,
    sr.boxes,
    sr.client_choice,
    sr.fedex_selection,
    sr.delivery_address,
    sr.expires_at,
    sr.responded_at,
    o.id,
    o.title,
    (
      select coalesce(jsonb_object_agg(cf.name, cfv.value), '{}'::jsonb)
      from public.custom_field_values cfv
      join public.custom_fields cf on cf.id = cfv.custom_field_id
      where cfv.order_id = o.id
    ) as order_fields,
    t.name,
    sr.tenant_id,
    coalesce(ss.payment_enabled, false),
    sr.payment_status,
    sr.payment_amount,
    sr.payment_currency,
    ss.shipper_street,
    ss.shipper_city,
    ss.shipper_state,
    ss.shipper_zip,
    ss.shipper_country,
    ss.pickup_hours_note
  from public.shipping_requests sr
  join public.orders o on o.id = sr.order_id
  join public.tenants t on t.id = sr.tenant_id
  left join public.shipping_settings ss on ss.tenant_id = sr.tenant_id
  where sr.token = p_token;
$$;

grant execute on function public.get_shipping_request_by_token(uuid) to anon, authenticated;

-- =============================================================================
-- Uber delivery + notes (migration 0047)
-- =============================================================================

alter table public.shipping_requests
  add column if not exists delivery_notes text,
  add column if not exists staff_notes text;

alter table public.shipping_requests drop constraint if exists shipping_requests_client_choice_check;
alter table public.shipping_requests add constraint shipping_requests_client_choice_check
  check (client_choice is null or client_choice in ('pickup', 'delivery', 'uber'));

drop function if exists public.get_shipping_request_by_token(uuid);

create function public.get_shipping_request_by_token(p_token uuid)
returns table (
  shipping_request_id uuid,
  status              text,
  boxes               jsonb,
  client_choice       text,
  fedex_selection     jsonb,
  delivery_address    jsonb,
  delivery_notes      text,
  expires_at          timestamptz,
  responded_at        timestamptz,
  order_id            uuid,
  order_title         text,
  order_fields        jsonb,
  tenant_name         text,
  tenant_id           uuid,
  payment_enabled     boolean,
  payment_status      text,
  payment_amount      integer,
  payment_currency    text,
  shipper_street      text,
  shipper_city        text,
  shipper_state       text,
  shipper_zip         text,
  shipper_country     text,
  pickup_hours_note   text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    sr.id,
    sr.status,
    sr.boxes,
    sr.client_choice,
    sr.fedex_selection,
    sr.delivery_address,
    sr.delivery_notes,
    sr.expires_at,
    sr.responded_at,
    o.id,
    o.title,
    (
      select coalesce(jsonb_object_agg(cf.name, cfv.value), '{}'::jsonb)
      from public.custom_field_values cfv
      join public.custom_fields cf on cf.id = cfv.custom_field_id
      where cfv.order_id = o.id
    ) as order_fields,
    t.name,
    sr.tenant_id,
    coalesce(ss.payment_enabled, false),
    sr.payment_status,
    sr.payment_amount,
    sr.payment_currency,
    ss.shipper_street,
    ss.shipper_city,
    ss.shipper_state,
    ss.shipper_zip,
    ss.shipper_country,
    ss.pickup_hours_note
  from public.shipping_requests sr
  join public.orders o on o.id = sr.order_id
  join public.tenants t on t.id = sr.tenant_id
  left join public.shipping_settings ss on ss.tenant_id = sr.tenant_id
  where sr.token = p_token;
$$;

grant execute on function public.get_shipping_request_by_token(uuid) to anon, authenticated;

-- =============================================================================
-- Delivery offer toggles + Curri (migration 0050)
-- =============================================================================

alter table public.shipping_settings
  add column if not exists offer_pickup boolean not null default true,
  add column if not exists offer_fedex boolean not null default true,
  add column if not exists offer_uber boolean not null default true,
  add column if not exists offer_curri boolean not null default false;

alter table public.shipping_requests drop constraint if exists shipping_requests_client_choice_check;
alter table public.shipping_requests add constraint shipping_requests_client_choice_check
  check (client_choice is null or client_choice in ('pickup', 'delivery', 'uber', 'curri'));

drop function if exists public.get_shipping_request_by_token(uuid);

create function public.get_shipping_request_by_token(p_token uuid)
returns table (
  shipping_request_id uuid,
  status              text,
  boxes               jsonb,
  client_choice       text,
  fedex_selection     jsonb,
  delivery_address    jsonb,
  delivery_notes      text,
  expires_at          timestamptz,
  responded_at        timestamptz,
  order_id            uuid,
  order_title         text,
  order_fields        jsonb,
  tenant_name         text,
  tenant_id           uuid,
  payment_enabled     boolean,
  payment_status      text,
  payment_amount      integer,
  payment_currency    text,
  shipper_street      text,
  shipper_city        text,
  shipper_state       text,
  shipper_zip         text,
  shipper_country     text,
  pickup_hours_note   text,
  offer_pickup        boolean,
  offer_fedex         boolean,
  offer_uber          boolean,
  offer_curri         boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    sr.id,
    sr.status,
    sr.boxes,
    sr.client_choice,
    sr.fedex_selection,
    sr.delivery_address,
    sr.delivery_notes,
    sr.expires_at,
    sr.responded_at,
    o.id,
    o.title,
    (
      select coalesce(jsonb_object_agg(cf.name, cfv.value), '{}'::jsonb)
      from public.custom_field_values cfv
      join public.custom_fields cf on cf.id = cfv.custom_field_id
      where cfv.order_id = o.id
    ) as order_fields,
    t.name,
    sr.tenant_id,
    coalesce(ss.payment_enabled, false),
    sr.payment_status,
    sr.payment_amount,
    sr.payment_currency,
    ss.shipper_street,
    ss.shipper_city,
    ss.shipper_state,
    ss.shipper_zip,
    ss.shipper_country,
    ss.pickup_hours_note,
    coalesce(ss.offer_pickup, true),
    coalesce(ss.offer_fedex, true),
    coalesce(ss.offer_uber, true),
    coalesce(ss.offer_curri, false)
  from public.shipping_requests sr
  join public.orders o on o.id = sr.order_id
  join public.tenants t on t.id = sr.tenant_id
  left join public.shipping_settings ss on ss.tenant_id = sr.tenant_id
  where sr.token = p_token;
$$;

grant execute on function public.get_shipping_request_by_token(uuid) to anon, authenticated;
