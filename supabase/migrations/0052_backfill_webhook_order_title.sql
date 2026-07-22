-- Backfill CRM order references on existing jobs.
-- webhook_order_title must be ORD-YYYY-#### (never a product/line description).
-- Also stamp webhook_source = 'crm' when we can derive an ORD reference.

with derived as (
  select
    o.id,
    coalesce(
      nullif(trim(o.specs->>'webhook_order_number'), ''),
      case
        -- Full ORD title, possibly with item suffix: ORD-2026-054-1 → ORD-2026-054
        when o.title ~* '^ORD-[0-9]{4}-[^-]+(-[0-9]+)?$' then
          case
            when o.title ~* '^ORD-[0-9]{4}-[^-]+-[0-9]+$' then
              regexp_replace(o.title, '-[0-9]+$', '')
            else o.title
          end
        -- Short card title: 0298-1 / 054 → ORD-{year}-0298 / ORD-{year}-054
        when o.title ~ '^[0-9]' then
          'ORD-'
          || to_char(
            timezone('America/Los_Angeles', o.created_at),
            'YYYY'
          )
          || '-'
          || regexp_replace(o.title, '-[0-9]+$', '')
        else null
      end
    ) as order_ref
  from public.orders o
)
update public.orders o
set
  specs = jsonb_set(
    coalesce(o.specs, '{}'::jsonb),
    '{webhook_order_title}',
    to_jsonb(d.order_ref),
    true
  ),
  webhook_source = case
    when o.webhook_source is null or btrim(o.webhook_source) = '' then 'crm'
    else o.webhook_source
  end
from derived d
where o.id = d.id
  and d.order_ref is not null
  and d.order_ref ~* '^ORD-[0-9]{4}-'
  and (
    o.specs->>'webhook_order_title' is null
    or btrim(o.specs->>'webhook_order_title') = ''
    or o.specs->>'webhook_order_title' !~* '^ORD-[0-9]{4}-'
  );
