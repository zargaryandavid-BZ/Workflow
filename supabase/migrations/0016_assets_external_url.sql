alter table public.assets
  add column if not exists external_url text;

alter table public.assets
  alter column storage_path drop not null;

alter table public.assets
  add constraint assets_has_location
  check (storage_path is not null or external_url is not null);
