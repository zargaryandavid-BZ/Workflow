-- Remember last successful catalog import URL (Settings → Fields).
alter table public.tenants
  add column if not exists catalog_import_url text;
