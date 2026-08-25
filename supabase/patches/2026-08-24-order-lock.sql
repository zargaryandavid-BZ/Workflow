-- Order lock (additive, idempotent). A team member freezes a card with a required
-- reason so nobody works it by mistake; only an admin or the person who locked it
-- can remove the lock.
alter table public.orders
  add column if not exists locked_by uuid references auth.users (id) on delete set null,
  add column if not exists locked_by_name text,
  add column if not exists lock_reason text,
  add column if not exists locked_at timestamptz;
