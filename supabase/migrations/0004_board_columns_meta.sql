-- =============================================================================
-- Board column metadata: custom color + picture, and an image storage bucket
-- =============================================================================

alter table public.board_columns
  add column if not exists color text,
  add column if not exists image_url text;

-- Public bucket for column header images. Path convention: {tenant_id}/{file}
insert into storage.buckets (id, name, public)
values ('column-images', 'column-images', true)
on conflict (id) do nothing;

drop policy if exists "column_images_member_insert" on storage.objects;
drop policy if exists "column_images_member_delete" on storage.objects;

create policy "column_images_member_insert" on storage.objects
  for insert with check (
    bucket_id = 'column-images'
    and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );

create policy "column_images_member_delete" on storage.objects
  for delete using (
    bucket_id = 'column-images'
    and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );
