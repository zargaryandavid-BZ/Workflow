-- Backfill specs.webhook_order_title from inbound webhook payload `title`.
-- Earlier code stored ORD-YYYY-#### there; the real title only lived in
-- webhook_history.request_payload. Prefer the latest successful history row
-- per order. Then clear any remaining ORD-only values.

with history_titles as (
  select distinct on (oid)
    oid as order_id,
    nullif(btrim(h.request_payload->>'title'), '') as title
  from public.webhook_history h
  cross join lateral unnest(h.order_ids) as oid
  where h.success = true
    and h.request_payload is not null
    and nullif(btrim(h.request_payload->>'title'), '') is not null
    -- Never treat the order number as a display title
    and btrim(h.request_payload->>'title') !~* '^ORD-[0-9]{4}-\S+$'
  order by oid, h.created_at desc
)
update public.orders o
set specs = jsonb_set(
  coalesce(o.specs, '{}'::jsonb),
  '{webhook_order_title}',
  to_jsonb(ht.title),
  true
)
from history_titles ht
where o.id = ht.order_id
  and ht.title is not null
  and (
    o.specs->>'webhook_order_title' is null
    or btrim(coalesce(o.specs->>'webhook_order_title', '')) = ''
    or o.specs->>'webhook_order_title' ~* '^ORD-[0-9]{4}-'
    or o.specs->>'webhook_order_title' is distinct from ht.title
  );

-- Also match via order_number when history has numbers but ids were empty,
-- or when cards share the CRM reference under specs.webhook_order_number /
-- an ORD-… card title.
with history_by_number as (
  select distinct on (o.id)
    o.id as order_id,
    nullif(btrim(h.request_payload->>'title'), '') as title
  from public.webhook_history h
  cross join lateral unnest(
    case
      when cardinality(h.order_numbers) > 0 then h.order_numbers
      else array[
        nullif(btrim(h.request_payload->>'order_number'), '')
      ]::text[]
    end
  ) as onum
  join public.orders o
    on o.tenant_id = h.tenant_id
   and onum is not null
   and (
      o.specs->>'webhook_order_number' = onum
      or o.title = onum
      or o.title like onum || '-%'
      or (
        o.title ~* '^ORD-[0-9]{4}-'
        and regexp_replace(o.title, '-[0-9]+$', '') = onum
      )
      or (
        -- Short card titles: 0329 / 0329-1 vs ORD-2026-0329
        onum ~* '^ORD-[0-9]{4}-'
        and (
          o.title = regexp_replace(onum, '^ORD-[0-9]{4}-', '', 'i')
          or o.title like regexp_replace(onum, '^ORD-[0-9]{4}-', '', 'i') || '-%'
        )
      )
    )
  where h.success = true
    and h.request_payload is not null
    and nullif(btrim(h.request_payload->>'title'), '') is not null
    and btrim(h.request_payload->>'title') !~* '^ORD-[0-9]{4}-\S+$'
    -- Skip orders already filled with a real (non-ORD) title
    and (
      o.specs->>'webhook_order_title' is null
      or btrim(coalesce(o.specs->>'webhook_order_title', '')) = ''
      or o.specs->>'webhook_order_title' ~* '^ORD-[0-9]{4}-'
    )
  order by o.id, h.created_at desc
)
update public.orders o
set specs = jsonb_set(
  coalesce(o.specs, '{}'::jsonb),
  '{webhook_order_title}',
  to_jsonb(hn.title),
  true
)
from history_by_number hn
where o.id = hn.order_id
  and hn.title is not null;

-- Drop legacy ORD-only display titles that were never recovered
update public.orders o
set specs = o.specs - 'webhook_order_title'
where o.specs ? 'webhook_order_title'
  and btrim(o.specs->>'webhook_order_title') ~* '^ORD-[0-9]{4}-\S+$';
