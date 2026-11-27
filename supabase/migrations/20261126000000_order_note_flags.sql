-- Per-note admin flags on a card (Hayk 2026-11-26).
--   { "hidden": ["internal:<id>", …], "production": ["internal:<id>", …] }
-- Keys are "<thread>:<note id>" (thread = internal | production | designer).
-- Hidden notes move to the admin-only "Hidden notes" section (never deleted).
-- "production" = an admin marked a non-production note for the press floor.
-- Kept OUT of specs on purpose: CRM / website / portal re-syncs and the card
-- form rewrite specs; this column is only written by /api/orders/[id]/note-flags.
-- Additive only: new nullable-safe column with an empty default, no data rewrite.
alter table public.orders
  add column if not exists note_flags jsonb not null default '{}'::jsonb;

comment on column public.orders.note_flags is
  'Admin note flags: {"hidden":[thread:id],"production":[thread:id]}. Written only by /api/orders/[id]/note-flags.';
