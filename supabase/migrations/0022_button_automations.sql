-- Button automation configs (modal action buttons) ----------------------------

create table if not exists public.button_automations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  name        text not null,
  icon        text,
  action_type text not null
    check (action_type in ('copy_link', 'send_email', 'generate_pdf')),
  column_ids  uuid[] not null default '{}',
  config      jsonb not null default '{}',
  position    integer not null default 0,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists button_automations_tenant_idx
  on public.button_automations (tenant_id, position);

drop trigger if exists button_automations_updated_at on public.button_automations;
create trigger button_automations_updated_at
  before update on public.button_automations
  for each row execute procedure public.update_updated_at();

alter table public.button_automations enable row level security;

create policy "button_automations_select_member" on public.button_automations
  for select using (public.is_tenant_member(tenant_id));
create policy "button_automations_admin_write" on public.button_automations
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
