-- Column archives: ZIP snapshots stored in Supabase Storage for later download.

create table if not exists public.column_archives (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  column_id     uuid references public.board_columns (id) on delete set null,
  column_name   text not null,
  storage_path  text,
  file_name     text,
  file_size     bigint,
  order_count   integer not null default 0,
  failure_count integer not null default 0,
  status        text not null default 'pending'
    check (status in ('pending', 'ready', 'failed')),
  error         text,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index if not exists column_archives_tenant_created_idx
  on public.column_archives (tenant_id, created_at desc);

alter table public.column_archives enable row level security;

drop policy if exists "column_archives_admin_all" on public.column_archives;
create policy "column_archives_admin_all" on public.column_archives
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- Private bucket for archive ZIPs. Path: {tenant_id}/{archive_id}/…
insert into storage.buckets (id, name, public)
values ('order-archives', 'order-archives', false)
on conflict (id) do nothing;

drop policy if exists "order_archives_admin_read" on storage.objects;
drop policy if exists "order_archives_admin_insert" on storage.objects;
drop policy if exists "order_archives_admin_delete" on storage.objects;

create policy "order_archives_admin_read" on storage.objects
  for select using (
    bucket_id = 'order-archives'
    and public.is_tenant_admin(((storage.foldername(name))[1])::uuid)
  );
create policy "order_archives_admin_insert" on storage.objects
  for insert with check (
    bucket_id = 'order-archives'
    and public.is_tenant_admin(((storage.foldername(name))[1])::uuid)
  );
create policy "order_archives_admin_delete" on storage.objects
  for delete using (
    bucket_id = 'order-archives'
    and public.is_tenant_admin(((storage.foldername(name))[1])::uuid)
  );
