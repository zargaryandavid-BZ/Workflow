-- Pickup codes live in orders.specs (pickup_code, and pickup_confirmation.code
-- after a pickup). These lookups run on every Ready-for-pickup send (to keep
-- codes unique) and every Pickup window confirm (to find the parts that share
-- a code). Optional: everything works without it, just slower on big tables.
create index if not exists orders_specs_pickup_code_idx
  on public.orders ((specs ->> 'pickup_code'))
  where specs ? 'pickup_code';

create index if not exists orders_specs_pickup_confirmation_code_idx
  on public.orders ((specs -> 'pickup_confirmation' ->> 'code'))
  where specs ? 'pickup_confirmation';
