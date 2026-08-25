-- Staff can confirm a manufacturer quote and place the final die order.

alter table public.die_requests
  drop constraint if exists die_requests_status_check;

alter table public.die_requests
  add constraint die_requests_status_check
  check (status in ('sent', 'quoted', 'ordered'));

alter table public.die_requests
  add column if not exists ordered_at timestamptz;
