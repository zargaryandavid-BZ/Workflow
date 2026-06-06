-- Renumber board_columns and custom_fields to clean sequential positions per tenant.
with ranked as (
  select
    id,
    row_number() over (
      partition by tenant_id
      order by position, created_at
    ) - 1 as new_pos
  from public.board_columns
)
update public.board_columns bc
set position = r.new_pos
from ranked r
where bc.id = r.id;

with ranked as (
  select
    id,
    row_number() over (
      partition by tenant_id
      order by position, created_at
    ) - 1 as new_pos
  from public.custom_fields
)
update public.custom_fields cf
set position = r.new_pos
from ranked r
where cf.id = r.id;
