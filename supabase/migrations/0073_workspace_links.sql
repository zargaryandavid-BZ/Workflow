-- Cross-workspace (cross-tenant) order mirroring.
-- Source workspace drops into a trigger column → mirror card in target workspace.
-- Mirror enters return column → original card moves to return_to column.

create table if not exists public.workspace_links (
  id uuid primary key default gen_random_uuid(),
  source_tenant_id uuid not null references public.tenants (id) on delete cascade,
  target_tenant_id uuid not null references public.tenants (id) on delete cascade,
  enabled boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint workspace_links_distinct_tenants check (source_tenant_id <> target_tenant_id),
  constraint workspace_links_unique_pair unique (source_tenant_id, target_tenant_id)
);

create table if not exists public.workspace_link_rules (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.workspace_links (id) on delete cascade,
  -- Source tenant: entering this column creates the mirror.
  trigger_column_id uuid not null references public.board_columns (id) on delete cascade,
  -- Target tenant: mirror is created in this column.
  mirror_start_column_id uuid not null references public.board_columns (id) on delete cascade,
  -- Target tenant: entering this column triggers return (optional until set).
  return_column_id uuid references public.board_columns (id) on delete set null,
  -- Source tenant: original card is moved here on return.
  return_to_column_id uuid references public.board_columns (id) on delete set null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists workspace_links_source_idx
  on public.workspace_links (source_tenant_id)
  where enabled = true;

create index if not exists workspace_links_target_idx
  on public.workspace_links (target_tenant_id)
  where enabled = true;

create index if not exists workspace_link_rules_link_idx
  on public.workspace_link_rules (link_id)
  where enabled = true;

create index if not exists workspace_link_rules_trigger_idx
  on public.workspace_link_rules (trigger_column_id)
  where enabled = true;

create index if not exists workspace_link_rules_return_idx
  on public.workspace_link_rules (return_column_id)
  where enabled = true and return_column_id is not null;

alter table public.workspace_links enable row level security;
alter table public.workspace_link_rules enable row level security;

-- Admins of the source tenant manage links; members of either side can read.
create policy workspace_links_select on public.workspace_links
  for select using (
    public.is_tenant_member(source_tenant_id)
    or public.is_tenant_member(target_tenant_id)
  );

create policy workspace_links_insert on public.workspace_links
  for insert with check (public.is_tenant_admin(source_tenant_id));

create policy workspace_links_update on public.workspace_links
  for update using (public.is_tenant_admin(source_tenant_id));

create policy workspace_links_delete on public.workspace_links
  for delete using (public.is_tenant_admin(source_tenant_id));

create policy workspace_link_rules_select on public.workspace_link_rules
  for select using (
    exists (
      select 1 from public.workspace_links l
      where l.id = link_id
        and (
          public.is_tenant_member(l.source_tenant_id)
          or public.is_tenant_member(l.target_tenant_id)
        )
    )
  );

create policy workspace_link_rules_write on public.workspace_link_rules
  for all using (
    exists (
      select 1 from public.workspace_links l
      where l.id = link_id
        and public.is_tenant_admin(l.source_tenant_id)
    )
  )
  with check (
    exists (
      select 1 from public.workspace_links l
      where l.id = link_id
        and public.is_tenant_admin(l.source_tenant_id)
    )
  );
