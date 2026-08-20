-- Short public codes for customer SMS/email links (/l/xY7kP2q).
-- Same target path always reuses the same code so reminders stay stable.

create table if not exists public.short_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null,
  target_path text not null,
  created_at timestamptz not null default now(),
  constraint short_links_code_key unique (code),
  constraint short_links_tenant_path_key unique (tenant_id, target_path)
);

create index if not exists short_links_code_idx on public.short_links (code);

alter table public.short_links enable row level security;

drop policy if exists "short_links_select_member" on public.short_links;
drop policy if exists "short_links_insert_member" on public.short_links;

create policy "short_links_select_member" on public.short_links
  for select using (public.is_tenant_member(tenant_id));

create policy "short_links_insert_member" on public.short_links
  for insert with check (public.is_tenant_member(tenant_id));
