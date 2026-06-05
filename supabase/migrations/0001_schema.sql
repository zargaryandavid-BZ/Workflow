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
  created_at timestamptz not null default now()
);
create index if not exists customers_tenant_idx on public.customers (tenant_id);

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
create type public.automation_trigger as enum ('on_enter_column', 'on_approval_result');

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
