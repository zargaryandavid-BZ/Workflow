-- Soft-remove orders (admin-only visibility for removed rows)

alter table public.orders
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references auth.users (id) on delete set null;

create index if not exists orders_removed_at_idx on public.orders (tenant_id, removed_at)
  where removed_at is not null;

drop policy if exists "orders_member_all" on public.orders;

create policy "orders_select_member" on public.orders
  for select using (
    public.is_tenant_member(tenant_id)
    and (
      removed_at is null
      or public.is_tenant_admin(tenant_id)
    )
  );

create policy "orders_insert_member" on public.orders
  for insert with check (
    public.is_tenant_member(tenant_id)
    and removed_at is null
  );

create policy "orders_update_member" on public.orders
  for update using (
    public.is_tenant_member(tenant_id)
    and (
      removed_at is null
      or public.is_tenant_admin(tenant_id)
    )
  )
  with check (
    public.is_tenant_member(tenant_id)
    and (
      public.is_tenant_admin(tenant_id)
      or removed_at is null
    )
  );

create policy "orders_delete_admin" on public.orders
  for delete using (public.is_tenant_admin(tenant_id));
