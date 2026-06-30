-- Warning animation display settings (per-tenant, admin-controlled)
-- opacity: 0–100 (default 30 = 30% opacity)
-- speed_ms: animation cycle duration in ms (default 2500 = 2.5 s)
-- spread_px: glow radius in px (default 3)

alter table public.tenants
  add column if not exists warning_opacity  smallint not null default 30
    check (warning_opacity  between 5 and 100),
  add column if not exists warning_speed_ms smallint not null default 2500
    check (warning_speed_ms between 500 and 8000),
  add column if not exists warning_spread_px smallint not null default 3
    check (warning_spread_px between 1 and 20);
