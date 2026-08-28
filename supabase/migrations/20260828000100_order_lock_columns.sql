-- Order lock columns (were only in supabase/patches/, never applied via migrations).
-- Additive + idempotent.
alter table public.orders
  add column if not exists locked_by uuid references auth.users (id) on delete set null,
  add column if not exists locked_by_name text,
  add column if not exists lock_reason text,
  add column if not exists locked_at timestamptz;
