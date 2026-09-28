-- Shared, cross-server cache for the Drive-status/PDF checks the board runs
-- per order card. Purely additive: new table only, nothing existing altered.
CREATE TABLE IF NOT EXISTS public.drive_status_cache (
  cache_key   text PRIMARY KEY,        -- `${tenantId}:${orderId}:<kind>`
  data        jsonb NOT NULL,
  expires_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drive_status_cache_expires_idx
  ON public.drive_status_cache (expires_at);

ALTER TABLE public.drive_status_cache ENABLE ROW LEVEL SECURITY;
-- No policies added: only the service-role (admin) client ever touches this
-- table, directly from server routes — never from the browser.
