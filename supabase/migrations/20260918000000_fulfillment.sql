-- Fulfillment boxes, line items, settings, and RLS.
-- Box numbers 1, 2, 3… are unique only among open packing boxes.
-- Sent/received days keep their numbers (labels use the send date).
-- Receive outcome + notes live on the box; line receive_status is kept for backfill.

create table if not exists public.fulfillment_boxes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  box_number text not null,
  status text not null default 'open', -- open | sent | received
  sent_at timestamptz,
  sent_by uuid references public.profiles(id),
  received_at timestamptz,
  received_by uuid references public.profiles(id),
  receive_status text,
  receive_comment text,
  created_at timestamptz not null default now()
);
create index if not exists fulfillment_boxes_tenant_idx on public.fulfillment_boxes(tenant_id);

-- Drop any leftover UNIQUE (tenant_id, box_number), whatever Postgres named it.
do $$
declare
  rec record;
begin
  for rec in
    select c.conname
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'fulfillment_boxes'
      and c.contype = 'u'
      and (
        select array_agg(att.attname::text order by u.ord)
        from unnest(c.conkey) with ordinality as u(attnum, ord)
        join pg_attribute att
          on att.attrelid = c.conrelid
         and att.attnum = u.attnum
      ) = array['tenant_id', 'box_number']::text[]
  loop
    execute format(
      'alter table public.fulfillment_boxes drop constraint if exists %I',
      rec.conname
    );
  end loop;
end $$;

create unique index if not exists fulfillment_boxes_open_number_uidx
  on public.fulfillment_boxes (tenant_id, box_number)
  where status = 'open';

alter table public.fulfillment_boxes
  add column if not exists receive_status text;

alter table public.fulfillment_boxes
  add column if not exists receive_comment text;

alter table public.fulfillment_boxes
  drop constraint if exists fulfillment_boxes_receive_status_check;

alter table public.fulfillment_boxes
  add constraint fulfillment_boxes_receive_status_check
  check (
    receive_status is null
    or receive_status in ('received', 'counted', 'missing')
  );

-- Orders inside boxes
create table if not exists public.fulfillment_box_orders (
  id uuid primary key default gen_random_uuid(),
  box_id uuid not null references public.fulfillment_boxes(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  quantity_expected integer,
  quantity_received integer,
  receive_status text,
  created_at timestamptz not null default now(),
  unique(box_id, order_id)
);
create index if not exists fulfillment_box_orders_box_idx on public.fulfillment_box_orders(box_id);
create index if not exists fulfillment_box_orders_order_idx on public.fulfillment_box_orders(order_id);

alter table public.fulfillment_box_orders
  add column if not exists receive_status text;

alter table public.fulfillment_box_orders
  drop constraint if exists fulfillment_box_orders_receive_status_check;

alter table public.fulfillment_box_orders
  add constraint fulfillment_box_orders_receive_status_check
  check (
    receive_status is null
    or receive_status in ('received', 'counted', 'missing')
  );

-- Per-tenant fulfillment settings
create table if not exists public.fulfillment_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  send_column_id uuid references public.board_columns(id) on delete set null,
  receive_column_id uuid references public.board_columns(id) on delete set null,
  counted_column_id uuid references public.board_columns(id) on delete set null,
  missing_column_id uuid references public.board_columns(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.fulfillment_settings
  add column if not exists counted_column_id uuid references public.board_columns(id) on delete set null;

alter table public.fulfillment_settings
  add column if not exists missing_column_id uuid references public.board_columns(id) on delete set null;

-- Copy the most severe line status onto boxes that were checked in per-item.
update public.fulfillment_boxes b
set receive_status = src.status
from (
  select
    box_id,
    case
      when bool_or(receive_status = 'missing') then 'missing'
      when bool_or(receive_status = 'received') then 'received'
      when bool_or(receive_status = 'counted') then 'counted'
      else null
    end as status
  from public.fulfillment_box_orders
  group by box_id
) src
where b.id = src.box_id
  and b.receive_status is null
  and src.status is not null;

-- RLS
alter table public.fulfillment_boxes enable row level security;
alter table public.fulfillment_box_orders enable row level security;
alter table public.fulfillment_settings enable row level security;

drop policy if exists "tenant members can manage fulfillment boxes"
  on public.fulfillment_boxes;
create policy "tenant members can manage fulfillment boxes"
  on public.fulfillment_boxes
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  );

drop policy if exists "tenant members can manage fulfillment box orders"
  on public.fulfillment_box_orders;
create policy "tenant members can manage fulfillment box orders"
  on public.fulfillment_box_orders
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  );

drop policy if exists "tenant members can manage fulfillment settings"
  on public.fulfillment_settings;
create policy "tenant members can manage fulfillment settings"
  on public.fulfillment_settings
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  );
