-- Feedback & improvements board: shared tenant bulletin for ideas, bugs, and requests.

create type public.feedback_type as enum (
  'improvement',
  'bug',
  'feature_request',
  'question',
  'other'
);

create table if not exists public.feedback (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  display_name  text not null,
  type          public.feedback_type not null default 'improvement',
  page          text not null,
  title         text not null,
  comment       text not null,
  status        text not null default 'open'
    check (status in ('open', 'in_review', 'planned', 'done', 'declined')),
  admin_note    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists feedback_tenant_idx
  on public.feedback (tenant_id, created_at desc);

create index if not exists feedback_user_idx
  on public.feedback (tenant_id, user_id);

drop trigger if exists feedback_updated_at on public.feedback;
create trigger feedback_updated_at
  before update on public.feedback
  for each row execute procedure public.update_updated_at();

-- Authors may only change content fields; admins may change status / admin_note too.
create or replace function public.feedback_guard_columns()
returns trigger
language plpgsql
as $$
begin
  if not public.is_tenant_admin(old.tenant_id) then
    if new.status is distinct from old.status
       or new.admin_note is distinct from old.admin_note
       or new.user_id is distinct from old.user_id
       or new.tenant_id is distinct from old.tenant_id
       or new.display_name is distinct from old.display_name
    then
      raise exception 'Not allowed to update protected feedback columns';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_guard_columns on public.feedback;
create trigger feedback_guard_columns
  before update on public.feedback
  for each row execute function public.feedback_guard_columns();

alter table public.feedback enable row level security;

-- Everyone in the tenant can read all feedback
drop policy if exists "feedback_select" on public.feedback;
create policy "feedback_select" on public.feedback
  for select using (public.is_tenant_member(tenant_id));

-- Anyone can insert their own feedback
drop policy if exists "feedback_insert" on public.feedback;
create policy "feedback_insert" on public.feedback
  for insert with check (
    public.is_tenant_member(tenant_id)
    and user_id = auth.uid()
  );

-- Authors can update their own rows; admins can update any row in the tenant
drop policy if exists "feedback_update" on public.feedback;
create policy "feedback_update" on public.feedback
  for update using (
    public.is_tenant_member(tenant_id)
    and (
      user_id = auth.uid()
      or public.is_tenant_admin(tenant_id)
    )
  )
  with check (
    public.is_tenant_member(tenant_id)
    and (
      user_id = auth.uid()
      or public.is_tenant_admin(tenant_id)
    )
  );

-- Only admins can delete
drop policy if exists "feedback_delete" on public.feedback;
create policy "feedback_delete" on public.feedback
  for delete using (public.is_tenant_admin(tenant_id));
