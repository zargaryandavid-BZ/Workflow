-- Per-tenant Google Drive folder automation settings.

create table if not exists public.gdrive_settings (
  tenant_id              uuid primary key references public.tenants (id) on delete cascade,
  enabled                boolean not null default false,
  client_email           text,
  private_key            text,
  root_folder_id         text,
  shared_drive_id        text,
  final_folder_name      text not null default 'Final for Prod',
  link_target            text not null default 'final'
                           check (link_target in ('customer', 'order', 'final')),
  open_on_create         boolean not null default true,
  updated_at             timestamptz not null default now()
);

alter table public.gdrive_settings enable row level security;

drop policy if exists "gdrive_settings_member_all" on public.gdrive_settings;
create policy "gdrive_settings_member_all" on public.gdrive_settings
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
