-- Die PDF attached in the Add Die popup, and the manufacturer picked there
-- (kept on drafts so "Send" later goes to the same one).
alter table public.dies
  add column if not exists pdf_path text,
  add column if not exists pdf_name text,
  add column if not exists pdf_size bigint,
  add column if not exists manufacturer_id uuid references public.die_manufacturers (id) on delete set null;
