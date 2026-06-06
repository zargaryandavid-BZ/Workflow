create table public.webhook_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  secret_key text not null unique,
  enabled boolean not null default true,
  label text not null default 'Default webhook',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (tenant_id)
);

alter table public.webhook_configs enable row level security;

create policy "webhook_configs_select_member" on public.webhook_configs
  for select using (public.is_tenant_member(tenant_id));

create policy "webhook_configs_admin_write" on public.webhook_configs
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

create index webhook_configs_secret_key_idx on public.webhook_configs (secret_key);
