-- =============================================================================
-- Security Advisor fixes (2026-09-10)
-- 1. Function Search Path Mutable — change `set search_path = public` to
--    `set search_path = ''` on all public.* functions.
--    All references inside each function body are already schema-qualified, so
--    no body changes are needed.
-- 2. Security Definer View — add security_invoker = on to the four flagged views
--    so they respect the querying user's RLS context instead of the view owner's.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1a. public.is_tenant_member
-- -----------------------------------------------------------------------------
create or replace function public.is_tenant_member(p_tenant uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant
      and m.user_id = auth.uid()
  );
$$;

-- -----------------------------------------------------------------------------
-- 1b. public.is_tenant_admin
-- -----------------------------------------------------------------------------
create or replace function public.is_tenant_admin(p_tenant uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant
      and m.user_id = auth.uid()
      and m.role = 'admin'
  );
$$;

-- -----------------------------------------------------------------------------
-- 1c. public.handle_new_user  (auth trigger)
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1d. public.create_tenant
-- -----------------------------------------------------------------------------
create or replace function public.create_tenant(p_name text, p_slug text)
returns public.tenants
language plpgsql
security definer
set search_path = ''
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

-- -----------------------------------------------------------------------------
-- 1e. public.get_notification_by_token
-- -----------------------------------------------------------------------------
drop function if exists public.get_notification_by_token(uuid);

create or replace function public.get_notification_by_token(p_token uuid)
returns table (
  notification_id   uuid,
  order_id          uuid,
  type              public.notification_type,
  status            public.notification_status,
  token_expires_at  timestamptz,
  staff_note        text,
  customer_note     text,
  customer_response text,
  order_title       text,
  order_description text,
  order_specs       jsonb,
  order_fields      jsonb,
  tenant_name       text,
  responded_at      timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    n.id,
    o.id,
    n.type,
    n.status,
    n.token_expires_at,
    n.staff_note,
    n.customer_note,
    n.customer_response,
    o.title,
    o.description,
    o.specs,
    (
      select coalesce(jsonb_object_agg(cf.name, cfv.value), '{}'::jsonb)
      from public.custom_field_values cfv
      join public.custom_fields cf on cf.id = cfv.custom_field_id
      where cfv.order_id = o.id
    ) as order_fields,
    t.name,
    n.responded_at
  from public.job_notifications n
  join public.orders o on o.id = n.order_id
  join public.tenants t on t.id = n.tenant_id
  where n.token = p_token;
$$;

grant execute on function public.get_notification_by_token(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1f. public.get_approval_by_token
-- -----------------------------------------------------------------------------
drop function if exists public.get_approval_by_token(uuid);

create or replace function public.get_approval_by_token(p_token uuid)
returns table (
  approval_id       uuid,
  order_id          uuid,
  status            public.approval_status,
  order_title       text,
  order_description text,
  order_specs       jsonb,
  order_fields      jsonb,
  tenant_name       text,
  comment           text,
  decided_at        timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    a.id,
    o.id,
    a.status,
    o.title,
    o.description,
    o.specs,
    (
      select coalesce(jsonb_object_agg(cf.name, cfv.value), '{}'::jsonb)
      from public.custom_field_values cfv
      join public.custom_fields cf on cf.id = cfv.custom_field_id
      where cfv.order_id = o.id
    ) as order_fields,
    t.name,
    a.comment,
    a.decided_at
  from public.approvals a
  join public.orders o on o.id = a.order_id
  join public.tenants t on t.id = a.tenant_id
  where a.token = p_token;
$$;

grant execute on function public.get_approval_by_token(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1g. public.get_shipping_request_by_token
-- -----------------------------------------------------------------------------
drop function if exists public.get_shipping_request_by_token(uuid);

create function public.get_shipping_request_by_token(p_token uuid)
returns table (
  shipping_request_id uuid,
  status              text,
  boxes               jsonb,
  client_choice       text,
  fedex_selection     jsonb,
  delivery_address    jsonb,
  delivery_notes      text,
  expires_at          timestamptz,
  responded_at        timestamptz,
  order_id            uuid,
  order_title         text,
  order_fields        jsonb,
  tenant_name         text,
  tenant_id           uuid,
  payment_enabled     boolean,
  payment_status      text,
  payment_amount      integer,
  payment_currency    text,
  shipper_street      text,
  shipper_city        text,
  shipper_state       text,
  shipper_zip         text,
  shipper_country     text,
  pickup_hours_note   text,
  offer_pickup        boolean,
  offer_fedex         boolean,
  offer_uber          boolean,
  offer_curri         boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    sr.id,
    sr.status,
    sr.boxes,
    sr.client_choice,
    sr.fedex_selection,
    sr.delivery_address,
    sr.delivery_notes,
    sr.expires_at,
    sr.responded_at,
    o.id,
    o.title,
    (
      select coalesce(jsonb_object_agg(cf.name, cfv.value), '{}'::jsonb)
      from public.custom_field_values cfv
      join public.custom_fields cf on cf.id = cfv.custom_field_id
      where cfv.order_id = o.id
    ) as order_fields,
    t.name,
    sr.tenant_id,
    coalesce(ss.payment_enabled, false),
    sr.payment_status,
    sr.payment_amount,
    sr.payment_currency,
    ss.shipper_street,
    ss.shipper_city,
    ss.shipper_state,
    ss.shipper_zip,
    ss.shipper_country,
    ss.pickup_hours_note,
    coalesce(ss.offer_pickup, true),
    coalesce(ss.offer_fedex, true),
    coalesce(ss.offer_uber, true),
    coalesce(ss.offer_curri, false)
  from public.shipping_requests sr
  join public.orders o on o.id = sr.order_id
  join public.tenants t on t.id = sr.tenant_id
  left join public.shipping_settings ss on ss.tenant_id = sr.tenant_id
  where sr.token = p_token;
$$;

grant execute on function public.get_shipping_request_by_token(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1h. public.get_approval_group_portal_by_token
-- -----------------------------------------------------------------------------
create or replace function public.get_approval_group_portal_by_token(p_token uuid)
returns table (
  portal_id   uuid,
  tenant_id   uuid,
  group_key   text,
  tenant_name text
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    p.id,
    p.tenant_id,
    p.group_key,
    t.name
  from public.approval_group_portals p
  join public.tenants t on t.id = p.tenant_id
  where p.token = p_token;
$$;

grant execute on function public.get_approval_group_portal_by_token(uuid)
  to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1i. public.user_notifications_guard_update  (trigger guard — missing search_path)
-- -----------------------------------------------------------------------------
create or replace function public.user_notifications_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.tenant_id is distinct from old.tenant_id
     or new.type is distinct from old.type
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.order_id is distinct from old.order_id
     or new.actor_id is distinct from old.actor_id
     or new.actor_name is distinct from old.actor_name
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Not allowed to update protected notification columns';
  end if;
  return new;
end;
$$;

-- =============================================================================
-- 2. Security Definer Views — enable security_invoker so views respect the
--    querying user's RLS policies instead of running as the view owner.
--    Skip views that are not present on this database.
-- =============================================================================
do $$
declare
  v_rel text;
begin
  foreach v_rel in array array[
    'ticket_workflow_status',
    'ticket_ops',
    'dashboard_pipeline_summary',
    'dashboard_ar_summary'
  ]
  loop
    if to_regclass('public.' || v_rel) is not null then
      execute format(
        'alter view public.%I set (security_invoker = on)',
        v_rel
      );
    end if;
  end loop;
end $$;
