-- Linked dropdowns: source select field filters options on a target select field.

create table if not exists public.field_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  source_field_id uuid not null references public.custom_fields (id) on delete cascade,
  target_field_id uuid not null references public.custom_fields (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tenant_id, source_field_id, target_field_id),
  check (source_field_id <> target_field_id)
);

create table if not exists public.field_link_mappings (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.field_links (id) on delete cascade,
  source_value text not null,
  target_value text not null,
  unique (link_id, source_value, target_value)
);

create index if not exists field_links_tenant_idx
  on public.field_links (tenant_id);

create index if not exists field_links_source_idx
  on public.field_links (source_field_id);

create index if not exists field_links_target_idx
  on public.field_links (target_field_id);

create index if not exists field_link_mappings_link_idx
  on public.field_link_mappings (link_id);

alter table public.field_links enable row level security;
alter table public.field_link_mappings enable row level security;

drop policy if exists "field_links_member_all" on public.field_links;
create policy "field_links_member_all" on public.field_links
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists "field_link_mappings_member_all" on public.field_link_mappings;
create policy "field_link_mappings_member_all" on public.field_link_mappings
  for all using (
    exists (
      select 1 from public.field_links fl
      where fl.id = link_id and public.is_tenant_member(fl.tenant_id)
    )
  )
  with check (
    exists (
      select 1 from public.field_links fl
      where fl.id = link_id and public.is_tenant_member(fl.tenant_id)
    )
  );
