-- Per-tenant editable SMS / email message templates (customer notification copy).

create table if not exists public.message_templates (
  tenant_id  uuid primary key references public.tenants (id) on delete cascade,
  templates  jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.message_templates enable row level security;

drop policy if exists "message_templates_select_member" on public.message_templates;
drop policy if exists "message_templates_admin_write" on public.message_templates;

create policy "message_templates_select_member" on public.message_templates
  for select using (public.is_tenant_member(tenant_id));

create policy "message_templates_admin_write" on public.message_templates
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
