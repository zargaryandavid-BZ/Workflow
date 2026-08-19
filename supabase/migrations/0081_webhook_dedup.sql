-- Webhook v2: idempotency keys + per-tenant CRM order identity.

create table if not exists public.processed_webhook_events (
  event_id     text        primary key,
  processed_at timestamptz not null default now()
);

create index if not exists processed_webhook_events_processed_at_idx
  on public.processed_webhook_events (processed_at);

alter table public.processed_webhook_events enable row level security;

-- Service role (webhook handler) bypasses RLS. No anon/authenticated access.

drop index if exists public.orders_crm_order_id_idx;
create unique index if not exists orders_tenant_crm_order_id_idx
  on public.orders (tenant_id, crm_order_id)
  where crm_order_id is not null;
