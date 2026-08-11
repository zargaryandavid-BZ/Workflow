-- Emergency / Urgency view balance thresholds (per-tenant, admin-controlled).
-- Empty object {} means "use built-in defaults" (see lib/emergency-balance.ts).

alter table public.tenants
  add column if not exists emergency_balance jsonb not null default '{}'::jsonb;
