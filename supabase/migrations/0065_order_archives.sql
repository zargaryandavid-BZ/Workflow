-- Allow Stored archives to record single-order ZIPs (as well as column batches).

alter table public.column_archives
  add column if not exists order_id uuid references public.orders (id) on delete set null;

alter table public.column_archives
  add column if not exists order_title text;

create index if not exists column_archives_tenant_order_idx
  on public.column_archives (tenant_id, order_id)
  where order_id is not null;3000