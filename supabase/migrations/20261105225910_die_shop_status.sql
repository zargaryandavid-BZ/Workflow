-- Shop-side die status and the date it was ordered. Reorder updates
-- ordered_at only; it does not email a manufacturer.

alter table public.dies
  add column if not exists shop_status text not null default 'working';

alter table public.dies
  drop constraint if exists dies_shop_status_check;

-- Same values as 0096 (Working / Out of order), so the order these two run in
-- doesn't matter. Old "problem" rows become out_of_order.
update public.dies set shop_status = 'out_of_order' where shop_status = 'problem';

alter table public.dies
  add constraint dies_shop_status_check
  check (shop_status in ('working', 'out_of_order'));

alter table public.dies
  add column if not exists ordered_at timestamptz;

update public.dies
  set ordered_at = created_at
  where ordered_at is null;

alter table public.dies
  alter column ordered_at set default now();

alter table public.dies
  alter column ordered_at set not null;
