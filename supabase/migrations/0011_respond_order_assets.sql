-- Expose order_id + custom fields on token lookups for client order review pages.

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
set search_path = public
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
set search_path = public
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
