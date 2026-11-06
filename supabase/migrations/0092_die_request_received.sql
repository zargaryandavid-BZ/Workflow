-- Staff mark an ordered die as received (it arrived at the shop). Stops the
-- "Die overdue" alarm and shows "Die received - DD.MM" on the board.

alter table public.die_requests
  drop constraint if exists die_requests_status_check;

alter table public.die_requests
  add constraint die_requests_status_check
  check (status in ('sent', 'quoted', 'ordered', 'received'));

alter table public.die_requests
  add column if not exists received_at timestamptz,
  add column if not exists received_by uuid references auth.users (id) on delete set null;
