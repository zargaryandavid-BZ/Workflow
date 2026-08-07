-- Default board priority (1–5) for new orders linked to this customer.
-- Null = no default; card priority can still be set manually per order.
alter table public.customers
  add column if not exists default_priority_score smallint
  check (
    default_priority_score is null
    or (default_priority_score >= 1 and default_priority_score <= 5)
  );

comment on column public.customers.default_priority_score is
  'Default specs.priority_score (1–5) applied to new orders from this customer.';
