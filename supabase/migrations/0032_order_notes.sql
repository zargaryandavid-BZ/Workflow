-- Internal notes per order (staff-only, not sent to customers)
create table public.order_notes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  order_id    uuid not null references public.orders(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null,
  text        text not null,
  created_at  timestamptz not null default now()
);

alter table public.order_notes enable row level security;

-- All tenant members can read and write notes
create policy "order_notes_member_select" on public.order_notes
  for select using (public.is_tenant_member(tenant_id));

create policy "order_notes_member_insert" on public.order_notes
  for insert with check (public.is_tenant_member(tenant_id));

-- Only the note author or a tenant admin can delete
create policy "order_notes_delete" on public.order_notes
  for delete using (
    created_by = auth.uid()
    or public.is_tenant_admin(tenant_id)
  );
