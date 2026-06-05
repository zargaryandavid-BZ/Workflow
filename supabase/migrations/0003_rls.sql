-- =============================================================================
-- Row-Level Security: tenant isolation on every table
-- =============================================================================

alter table public.tenants            enable row level security;
alter table public.profiles           enable row level security;
alter table public.memberships        enable row level security;
alter table public.board_columns      enable row level security;
alter table public.customers          enable row level security;
alter table public.orders             enable row level security;
alter table public.custom_fields      enable row level security;
alter table public.custom_field_values enable row level security;
alter table public.assets             enable row level security;
alter table public.approvals          enable row level security;
alter table public.automation_rules   enable row level security;
alter table public.activity_log       enable row level security;

-- Tenants --------------------------------------------------------------------
create policy "tenants_select_member" on public.tenants
  for select using (public.is_tenant_member(id));
create policy "tenants_update_admin" on public.tenants
  for update using (public.is_tenant_admin(id));

-- Profiles -------------------------------------------------------------------
create policy "profiles_select_self_or_teammate" on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from public.memberships me
      join public.memberships them on them.tenant_id = me.tenant_id
      where me.user_id = auth.uid() and them.user_id = profiles.id
    )
  );
create policy "profiles_update_self" on public.profiles
  for update using (id = auth.uid());
create policy "profiles_insert_self" on public.profiles
  for insert with check (id = auth.uid());

-- Memberships ----------------------------------------------------------------
create policy "memberships_select_member" on public.memberships
  for select using (public.is_tenant_member(tenant_id));
create policy "memberships_admin_write" on public.memberships
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- Board columns --------------------------------------------------------------
create policy "columns_select_member" on public.board_columns
  for select using (public.is_tenant_member(tenant_id));
create policy "columns_admin_write" on public.board_columns
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- Customers ------------------------------------------------------------------
create policy "customers_member_all" on public.customers
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Orders ---------------------------------------------------------------------
create policy "orders_member_all" on public.orders
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Custom fields (definitions: admins manage, members read) -------------------
create policy "custom_fields_select_member" on public.custom_fields
  for select using (public.is_tenant_member(tenant_id));
create policy "custom_fields_admin_write" on public.custom_fields
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- Custom field values (any member of the order's tenant) ---------------------
create policy "cfv_member_all" on public.custom_field_values
  for all using (
    exists (
      select 1 from public.orders o
      where o.id = custom_field_values.order_id
        and public.is_tenant_member(o.tenant_id)
    )
  )
  with check (
    exists (
      select 1 from public.orders o
      where o.id = custom_field_values.order_id
        and public.is_tenant_member(o.tenant_id)
    )
  );

-- Assets ---------------------------------------------------------------------
create policy "assets_member_all" on public.assets
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Approvals (members manage; public read goes through the SECURITY DEFINER RPC)
create policy "approvals_member_all" on public.approvals
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Automation rules (admins manage, members read) -----------------------------
create policy "automation_select_member" on public.automation_rules
  for select using (public.is_tenant_member(tenant_id));
create policy "automation_admin_write" on public.automation_rules
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- Activity log (members read; inserts via members / service role) ------------
create policy "activity_select_member" on public.activity_log
  for select using (public.is_tenant_member(tenant_id));
create policy "activity_insert_member" on public.activity_log
  for insert with check (public.is_tenant_member(tenant_id));

-- =============================================================================
-- Storage bucket + policies for order assets
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('order-assets', 'order-assets', false)
on conflict (id) do nothing;

-- Path convention: {tenant_id}/{order_id}/{filename}
-- The first path segment is the tenant id; membership is checked against it.
create policy "order_assets_member_read" on storage.objects
  for select using (
    bucket_id = 'order-assets'
    and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );
create policy "order_assets_member_insert" on storage.objects
  for insert with check (
    bucket_id = 'order-assets'
    and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );
create policy "order_assets_member_delete" on storage.objects
  for delete using (
    bucket_id = 'order-assets'
    and public.is_tenant_member(((storage.foldername(name))[1])::uuid)
  );
