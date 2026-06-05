-- =============================================================================
-- Custom fields: per-field "required" flag
-- =============================================================================

alter table public.custom_fields
  add column if not exists required boolean not null default false;
