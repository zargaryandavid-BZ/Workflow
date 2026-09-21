-- Production Priority Board feature (additive only — no existing column touched).
--
-- 1. `press` — which HP Indigo press (6K / 15K) an order runs on. Nullable:
--    not every order goes through a press (e.g. apparel/shipping-only rows).
-- 2. Daily priority list per press: `daily_priority_bucket` (today/tomorrow),
--    `daily_priority_rank` (lower = higher priority, ordering only — not
--    enforced unique at the DB level, ties broken by created_at in the app),
--    `daily_priority_done` / `daily_priority_done_at` — staff "done" checkbox
--    in the shared Priority List view.
-- 3. `production_stage` — 5-step shop-floor status tag (printing, lamination,
--    uv, cutting, folding) any staff member can set from the card. Forward-only
--    current value, not an audit log (activity_log still gets a line on change).

alter table public.orders
  add column if not exists press text;

alter table public.orders
  add column if not exists production_stage text;

alter table public.orders
  add column if not exists daily_priority_bucket text;

alter table public.orders
  add column if not exists daily_priority_rank integer;

alter table public.orders
  add column if not exists daily_priority_done boolean not null default false;

alter table public.orders
  add column if not exists daily_priority_done_at timestamptz;

alter table public.orders
  drop constraint if exists orders_press_check;

alter table public.orders
  add constraint orders_press_check
  check (press is null or press in ('6K', '15K'));

alter table public.orders
  drop constraint if exists orders_production_stage_check;

alter table public.orders
  add constraint orders_production_stage_check
  check (
    production_stage is null
    or production_stage in ('printing', 'lamination', 'uv', 'cutting', 'folding')
  );

alter table public.orders
  drop constraint if exists orders_daily_priority_bucket_check;

alter table public.orders
  add constraint orders_daily_priority_bucket_check
  check (daily_priority_bucket is null or daily_priority_bucket in ('today', 'tomorrow'));

-- Fast lookup for the Priority List view (per tenant + press + bucket, ordered by rank).
create index if not exists orders_daily_priority_idx
  on public.orders (tenant_id, press, daily_priority_bucket, daily_priority_rank)
  where daily_priority_bucket is not null;

-- No RLS changes needed — orders already has a tenant-member policy covering
-- all columns (see 0003_rls.sql); these are plain additive columns on it.
