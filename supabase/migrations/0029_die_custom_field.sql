-- Add "Die" text field to every existing tenant that does not already have it.
-- Position 999 so it sorts after existing fields; admins can reorder in Settings.
insert into public.custom_fields (tenant_id, name, field_type, position, required)
select
  t.id,
  'Die',
  'text',
  coalesce(
    (select max(cf2.position) from public.custom_fields cf2 where cf2.tenant_id = t.id),
    0
  ) + 10,
  false
from public.tenants t
where not exists (
  select 1 from public.custom_fields cf
  where cf.tenant_id = t.id
    and lower(cf.name) = 'die'
);
