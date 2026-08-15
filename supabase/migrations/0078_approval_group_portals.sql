-- Stable customer-facing approval portal per multi-item order group.
-- Every SMS/email for any sub-item reuses the same /respond/g/{token} link.

create table if not exists public.approval_group_portals (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  group_key  text not null,
  token      uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  unique (tenant_id, group_key)
);

create index if not exists approval_group_portals_token_idx
  on public.approval_group_portals (token);

alter table public.approval_group_portals enable row level security;

-- Staff can read/create portals for their tenants.
drop policy if exists "approval_group_portals_member_select" on public.approval_group_portals;
create policy "approval_group_portals_member_select" on public.approval_group_portals
  for select using (public.is_tenant_member(tenant_id));

drop policy if exists "approval_group_portals_member_insert" on public.approval_group_portals;
create policy "approval_group_portals_member_insert" on public.approval_group_portals
  for insert with check (public.is_tenant_member(tenant_id));

-- Public lookup by token (anon customer link).
create or replace function public.get_approval_group_portal_by_token(p_token uuid)
returns table (
  portal_id   uuid,
  tenant_id   uuid,
  group_key   text,
  tenant_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.tenant_id,
    p.group_key,
    t.name
  from public.approval_group_portals p
  join public.tenants t on t.id = p.tenant_id
  where p.token = p_token;
$$;

grant execute on function public.get_approval_group_portal_by_token(uuid)
  to anon, authenticated;
