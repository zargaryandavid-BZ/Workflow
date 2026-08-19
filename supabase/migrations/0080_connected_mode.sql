-- Connected Mode: CRM catalog as source of truth for product specs.
-- Order snapshot + sticky overrides, catalog cache, tenant integration setting.

-- ---------------------------------------------------------------------------
-- Orders: CRM snapshot, sticky overrides, per-order mode
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists crm_order_id text,
  add column if not exists crm_updated_at timestamptz,
  add column if not exists crm_snapshot jsonb,
  add column if not exists user_overrides jsonb default '{}'::jsonb,
  add column if not exists integration_mode text
    check (integration_mode is null or integration_mode in ('local', 'connected'));

create unique index if not exists orders_crm_order_id_idx
  on public.orders (crm_order_id)
  where crm_order_id is not null;

-- Atomic JSONB merge: user_overrides || patch (patch wins).
create or replace function public.merge_order_user_overrides(
  p_order_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  update public.orders
  set user_overrides = coalesce(user_overrides, '{}'::jsonb) || p_patch
  where id = p_order_id
    and public.is_tenant_member(tenant_id)
  returning user_overrides into result;
  return result;
end;
$$;

revoke execute on function public.merge_order_user_overrides(uuid, jsonb) from public;
revoke execute on function public.merge_order_user_overrides(uuid, jsonb) from anon;
grant execute on function public.merge_order_user_overrides(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Catalog cache (one row per tenant)
-- ---------------------------------------------------------------------------
create table if not exists public.catalog_cache (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  cached_at timestamptz not null default now(),
  payload jsonb not null,
  primary key (tenant_id)
);

alter table public.catalog_cache enable row level security;

drop policy if exists "catalog_cache_select_member" on public.catalog_cache;
drop policy if exists "catalog_cache_admin_write" on public.catalog_cache;

create policy "catalog_cache_select_member" on public.catalog_cache
  for select using (public.is_tenant_member(tenant_id));

create policy "catalog_cache_admin_write" on public.catalog_cache
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- Tenant: default mode for new orders + CRM catalog URL
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists integration_mode text
    not null default 'local'
    check (integration_mode in ('local', 'connected')),
  add column if not exists crm_catalog_url text;
