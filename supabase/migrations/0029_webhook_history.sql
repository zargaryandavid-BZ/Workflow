create table public.webhook_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  webhook_config_id uuid not null references public.webhook_configs (id) on delete cascade,
  request_payload jsonb,
  request_raw text,
  response_payload jsonb,
  response_status integer not null,
  success boolean not null default false,
  error_message text,
  order_ids uuid[] not null default '{}',
  order_numbers text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.webhook_history enable row level security;

create policy "webhook_history_select_member" on public.webhook_history
  for select using (public.is_tenant_member(tenant_id));

create policy "webhook_history_admin_write" on public.webhook_history
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

create index webhook_history_tenant_created_idx
  on public.webhook_history (tenant_id, created_at desc);
