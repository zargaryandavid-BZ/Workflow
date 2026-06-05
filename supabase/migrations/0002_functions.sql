-- =============================================================================
-- Helper functions, tenant provisioning, profile sync, and public approval RPCs
-- =============================================================================

-- Membership check used by RLS policies. SECURITY DEFINER so it can read
-- memberships without recursing through the table's own RLS policies.
create or replace function public.is_tenant_member(p_tenant uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_tenant_admin(p_tenant uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant
      and m.user_id = auth.uid()
      and m.role = 'admin'
  );
$$;

-- Auto-create a profile row when a new auth user signs up --------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Create a tenant, seed default columns, and make the caller an admin -------
create or replace function public.create_tenant(p_name text, p_slug text)
returns public.tenants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.tenants (name, slug)
  values (p_name, p_slug)
  returning * into v_tenant;

  insert into public.memberships (user_id, tenant_id, role)
  values (v_uid, v_tenant.id, 'admin');

  insert into public.board_columns (tenant_id, name, position, kind) values
    (v_tenant.id, 'START (Order Created)', 0, 'normal'),
    (v_tenant.id, 'In Progress',          1, 'normal'),
    (v_tenant.id, 'Missing Info',         2, 'exception'),
    (v_tenant.id, 'Returning Tickets',    3, 'exception'),
    (v_tenant.id, 'Customer Approval',    4, 'approval'),
    (v_tenant.id, 'Done (Ready for Prod)',5, 'done');

  -- Seed default automations: approve -> Done, reject -> Returning Tickets
  insert into public.automation_rules (tenant_id, trigger, from_column, to_column, config)
  select
    v_tenant.id,
    'on_approval_result',
    (select id from public.board_columns where tenant_id = v_tenant.id and kind = 'approval'),
    (select id from public.board_columns where tenant_id = v_tenant.id and kind = 'done'),
    '{"result": "approved"}'::jsonb;

  insert into public.automation_rules (tenant_id, trigger, from_column, to_column, config)
  select
    v_tenant.id,
    'on_approval_result',
    (select id from public.board_columns where tenant_id = v_tenant.id and kind = 'approval'),
    (select id from public.board_columns where tenant_id = v_tenant.id and name = 'Returning Tickets'),
    '{"result": "rejected"}'::jsonb;

  return v_tenant;
end;
$$;

-- Public, token-addressable view of an approval for the customer page --------
create or replace function public.get_approval_by_token(p_token uuid)
returns table (
  approval_id uuid,
  status public.approval_status,
  order_title text,
  order_description text,
  order_specs jsonb,
  tenant_name text,
  comment text,
  decided_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id,
    a.status,
    o.title,
    o.description,
    o.specs,
    t.name,
    a.comment,
    a.decided_at
  from public.approvals a
  join public.orders o on o.id = a.order_id
  join public.tenants t on t.id = a.tenant_id
  where a.token = p_token;
$$;

grant execute on function public.get_approval_by_token(uuid) to anon, authenticated;
grant execute on function public.create_tenant(text, text) to authenticated;
grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.is_tenant_admin(uuid) to authenticated;
