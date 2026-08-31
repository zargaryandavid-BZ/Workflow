-- One CRM order can map to several board cards (one per line item).
-- Keep crm_order_id on every card for re-sync; uniqueness is per tenant+id+card.
drop index if exists public.orders_tenant_crm_order_id_idx;

create index if not exists orders_tenant_crm_order_id_idx
  on public.orders (tenant_id, crm_order_id)
  where crm_order_id is not null;
