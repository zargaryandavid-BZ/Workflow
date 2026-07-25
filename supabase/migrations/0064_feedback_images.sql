-- Screenshot / image attachments for feedback entries.

create table if not exists public.feedback_images (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  feedback_id  uuid not null references public.feedback (id) on delete cascade,
  file_name    text not null,
  file_size    bigint,
  mime_type    text,
  storage_path text not null,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists feedback_images_feedback_idx
  on public.feedback_images (feedback_id, position);

create index if not exists feedback_images_tenant_idx
  on public.feedback_images (tenant_id);

alter table public.feedback_images enable row level security;

-- Tenant members can view all feedback images
drop policy if exists "feedback_images_select" on public.feedback_images;
create policy "feedback_images_select" on public.feedback_images
  for select using (public.is_tenant_member(tenant_id));

-- Authors can attach images to their own feedback
drop policy if exists "feedback_images_insert" on public.feedback_images;
create policy "feedback_images_insert" on public.feedback_images
  for insert with check (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1 from public.feedback f
      where f.id = feedback_id
        and f.tenant_id = tenant_id
        and f.user_id = auth.uid()
    )
  );

-- Authors or admins can delete images
drop policy if exists "feedback_images_delete" on public.feedback_images;
create policy "feedback_images_delete" on public.feedback_images
  for delete using (
    public.is_tenant_admin(tenant_id)
    or exists (
      select 1 from public.feedback f
      where f.id = feedback_id
        and f.tenant_id = tenant_id
        and f.user_id = auth.uid()
    )
  );

-- Private bucket for feedback screenshots
insert into storage.buckets (id, name, public)
values ('feedback-images', 'feedback-images', false)
on conflict (id) do nothing;

drop policy if exists "feedback_images_storage_select" on storage.objects;
drop policy if exists "feedback_images_storage_insert" on storage.objects;
drop policy if exists "feedback_images_storage_delete" on storage.objects;

create policy "feedback_images_storage_select" on storage.objects
  for select using (
    bucket_id = 'feedback-images'
    and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );

create policy "feedback_images_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'feedback-images'
    and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );

create policy "feedback_images_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'feedback-images'
    and (
      public.is_tenant_admin(((storage.foldername(name))[1])::uuid)
      or public.is_tenant_member(((storage.foldername(name))[1])::uuid)
    )
  );
