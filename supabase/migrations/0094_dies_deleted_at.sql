-- Deleting a die hides it instead of removing the row, so its Template ID
-- (and any printed QR code) is never given to a new die.
alter table public.dies
  add column if not exists deleted_at timestamptz;
