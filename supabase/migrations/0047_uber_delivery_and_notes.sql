-- Uber delivery option + client/staff notes on shipping_requests.
-- Also widens client_choice check (0044 only allowed pickup|delivery).

alter table public.shipping_requests
  add column if not exists delivery_notes text,
  add column if not exists staff_notes text;

alter table public.shipping_requests drop constraint if exists shipping_requests_client_choice_check;
alter table public.shipping_requests add constraint shipping_requests_client_choice_check
  check (client_choice is null or client_choice in ('pickup', 'delivery', 'uber'));

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
  pickup_hours_note   text
)
language sql
security definer
set search_path = public
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
    ss.pickup_hours_note
  from public.shipping_requests sr
  join public.orders o on o.id = sr.order_id
  join public.tenants t on t.id = sr.tenant_id
  left join public.shipping_settings ss on ss.tenant_id = sr.tenant_id
  where sr.token = p_token;
$$;

grant execute on function public.get_shipping_request_by_token(uuid) to anon, authenticated;
