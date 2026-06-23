-- Fast Action Buttons — one-click column-move shortcuts inside order card modals

create table if not exists public.fast_action_buttons (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants (id) on delete cascade,
  name                  text not null,
  color                 text not null default 'blue'
    check (color in ('blue', 'green', 'red', 'orange', 'yellow', 'purple', 'gray')),
  destination_column_id uuid references public.board_columns (id) on delete set null,
  show_in_columns       text[] not null default '{}',
  visible_to_roles      text[] not null default '{}',
  notification_rule_id  uuid references public.notification_rules (id) on delete set null,
  enabled               boolean not null default true,
  position              integer not null default 0,
  created_at            timestamptz not null default now()
);

create index if not exists fast_action_buttons_tenant_idx
  on public.fast_action_buttons (tenant_id, position);

create index if not exists fast_action_buttons_destination_idx
  on public.fast_action_buttons (destination_column_id);

alter table public.fast_action_buttons enable row level security;

drop policy if exists "fast_action_buttons_select_member" on public.fast_action_buttons;
drop policy if exists "fast_action_buttons_admin_write" on public.fast_action_buttons;

create policy "fast_action_buttons_select_member" on public.fast_action_buttons
  for select using (public.is_tenant_member(tenant_id));
create policy "fast_action_buttons_admin_write" on public.fast_action_buttons
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
