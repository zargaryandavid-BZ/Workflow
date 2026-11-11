-- Holo card stock (Hayk 2026-11-11): Bazaar laminates holo foil onto 16pt /
-- 18pt card stock in-house, on one or both sides. Add the four stocks to every
-- tenant's "Materials" dropdown so website + CRM orders map to a real option.
-- Additive only: appends missing options; existing options and cards untouched.

update public.custom_fields cf
set options = cf.options || (
  select coalesce(jsonb_agg(v), '[]'::jsonb)
  from jsonb_array_elements_text(
    '["16pt Holo 1-Side","16pt Holo 2-Side","18pt Holo 1-Side","18pt Holo 2-Side"]'::jsonb
  ) as v
  where not exists (
    select 1 from jsonb_array_elements_text(cf.options) o
    where lower(o) = lower(v)
  )
)
where lower(cf.name) = 'materials'
  and cf.field_type = 'select';
