-- Add "Category" select field (product taxonomy parent) for every tenant.
-- Cascades with Product → Materials on the order form.
-- Distinct from board tags (formerly "categories").

insert into public.custom_fields (
  tenant_id,
  name,
  field_type,
  options,
  position,
  required
)
select
  t.id,
  'Category',
  'select',
  '[
    "Combos",
    "Labels & Stickers",
    "Packaging & Boxes",
    "Print",
    "Signage / Large Format",
    "Apparel",
    "Components",
    "Other"
  ]'::jsonb,
  coalesce(
    (
      select cf2.position
      from public.custom_fields cf2
      where cf2.tenant_id = t.id
        and lower(cf2.name) = 'product'
      limit 1
    ),
    coalesce(
      (select max(cf3.position) from public.custom_fields cf3 where cf3.tenant_id = t.id),
      0
    ) + 1
  ),
  false
from public.tenants t
where not exists (
  select 1 from public.custom_fields cf
  where cf.tenant_id = t.id
    and lower(cf.name) = 'category'
);

-- Backfill Category from existing Product values.
insert into public.custom_field_values (order_id, custom_field_id, value)
select
  pv.order_id,
  cat.id,
  to_jsonb(
    case lower(trim(both '"' from pv.value::text))
      when 'pouches combo' then 'Combos'
      when 'jar combo' then 'Combos'
      when 'tube combo' then 'Combos'
      when 'labels (roll)' then 'Labels & Stickers'
      when 'labels (sheet)' then 'Labels & Stickers'
      when 'diecut stickers' then 'Labels & Stickers'
      when 'folding cartons / boxes' then 'Packaging & Boxes'
      when 'business cards' then 'Print'
      when 'flyers / postcards' then 'Print'
      when 'booklets' then 'Print'
      when 'sheet products (boyd)' then 'Print'
      when 'vinyl labels / 54'''' rolls' then 'Signage / Large Format'
      when 'vinyl signage' then 'Signage / Large Format'
      when 'banners / large format' then 'Signage / Large Format'
      when 'window decals' then 'Signage / Large Format'
      when 'wallpaper' then 'Signage / Large Format'
      when 'apparel' then 'Apparel'
      when 'pouches only' then 'Components'
      when 'tube only' then 'Components'
      when 'jar only' then 'Components'
      when 'other' then 'Other'
      else null
    end
  )
from public.custom_field_values pv
join public.custom_fields prod
  on prod.id = pv.custom_field_id
 and lower(prod.name) = 'product'
join public.custom_fields cat
  on cat.tenant_id = prod.tenant_id
 and lower(cat.name) = 'category'
where not exists (
  select 1
  from public.custom_field_values existing
  where existing.order_id = pv.order_id
    and existing.custom_field_id = cat.id
)
and case lower(trim(both '"' from pv.value::text))
  when 'pouches combo' then true
  when 'jar combo' then true
  when 'tube combo' then true
  when 'labels (roll)' then true
  when 'labels (sheet)' then true
  when 'diecut stickers' then true
  when 'folding cartons / boxes' then true
  when 'business cards' then true
  when 'flyers / postcards' then true
  when 'booklets' then true
  when 'sheet products (boyd)' then true
  when 'vinyl labels / 54'''' rolls' then true
  when 'vinyl signage' then true
  when 'banners / large format' then true
  when 'window decals' then true
  when 'wallpaper' then true
  when 'apparel' then true
  when 'pouches only' then true
  when 'tube only' then true
  when 'jar only' then true
  when 'other' then true
  else false
end;
