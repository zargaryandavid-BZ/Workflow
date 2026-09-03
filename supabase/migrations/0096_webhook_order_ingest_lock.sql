-- Serialize concurrent v1 CRM/portal webhooks for the same order_number,
-- and prevent a second insert of the same live line when the lock is skipped.

create table if not exists public.webhook_order_ingest_locks (
  tenant_id   uuid        not null references public.tenants (id) on delete cascade,
  order_key   text        not null,
  claimed_at  timestamptz not null default now(),
  primary key (tenant_id, order_key)
);

alter table public.webhook_order_ingest_locks enable row level security;

-- Keep the oldest live card per CRM line; archive extras from double POSTs.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        tenant_id,
        specs->>'webhook_order_number',
        coalesce(specs->>'webhook_item_index', '0')
      order by created_at asc, id asc
    ) as rn
  from public.orders
  where removed_at is null
    and nullif(btrim(specs->>'webhook_order_number'), '') is not null
)
update public.orders o
set
  removed_at = now(),
  updated_at = now()
from ranked r
where o.id = r.id
  and r.rn > 1;

create unique index if not exists orders_tenant_webhook_line_uidx
  on public.orders (
    tenant_id,
    (specs->>'webhook_order_number'),
    (coalesce(specs->>'webhook_item_index', '0'))
  )
  where removed_at is null
    and nullif(btrim(specs->>'webhook_order_number'), '') is not null;
