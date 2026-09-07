-- Live Integrations list when Admin one-click writes webhook_configs.
alter table public.webhook_configs replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'webhook_configs'
  ) then
    alter publication supabase_realtime add table public.webhook_configs;
  end if;
end $$;
