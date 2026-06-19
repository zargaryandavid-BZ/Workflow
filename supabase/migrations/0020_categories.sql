-- Categories for organizing orders ------------------------------------------------

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  name        text not null,
  color       text not null default '#6366f1',
  description text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists categories_tenant_position_idx
  on public.categories (tenant_id, position);

create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists categories_updated_at on public.categories;
create trigger categories_updated_at
  before update on public.categories
  for each row execute procedure public.update_updated_at();

alter table public.categories enable row level security;

create policy "categories_select_member" on public.categories
  for select using (public.is_tenant_member(tenant_id));
create policy "categories_admin_write" on public.categories
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

alter table public.orders
  add column if not exists category_id uuid references public.categories (id) on delete set null;
