-- Per-tenant shipping / FedEx / Stripe configuration + payment tracking on shipping_requests.

create table if not exists public.shipping_settings (
  tenant_id              uuid primary key references public.tenants (id) on delete cascade,
  fedex_api_key          text,
  fedex_secret_key       text,
  fedex_account_number   text,
  fedex_sandbox          boolean not null default true,
  shipper_street         text,
  shipper_city           text,
  shipper_state          text,
  shipper_zip            text,
  shipper_country        text not null default 'US',
  pickup_hours_note      text,
  payment_enabled        boolean not null default false,
  stripe_publishable_key text,
  stripe_secret_key      text,
  stripe_webhook_secret  text,
  markup_fixed_cents     integer not null default 0 check (markup_fixed_cents >= 0),
  markup_percent         numeric(6, 2) not null default 0 check (markup_percent >= 0),
  updated_at             timestamptz not null default now()
);

alter table public.shipping_settings enable row level security;

drop policy if exists "shipping_settings_member_all" on public.shipping_settings;
create policy "shipping_settings_member_all" on public.shipping_settings
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

alter table public.shipping_requests
  add column if not exists checkout_session_id text,
  add column if not exists payment_intent_id text,
  add column if not exists payment_status text,
  add column if not exists payment_amount integer,
  add column if not exists payment_currency text default 'usd';

alter table public.shipping_requests drop constraint if exists shipping_requests_payment_status_check;
alter table public.shipping_requests add constraint shipping_requests_payment_status_check
  check (payment_status is null or payment_status in ('pending', 'succeeded', 'failed'));

alter table public.shipping_requests drop constraint if exists shipping_requests_status_check;
alter table public.shipping_requests add constraint shipping_requests_status_check
  check (status in ('pending', 'payment_pending', 'client_responded'));

drop function if exists public.get_shipping_request_by_token(uuid);

create function public.get_shipping_request_by_token(p_token uuid)
returns table (
  shipping_request_id uuid,
  status              text,
  boxes               jsonb,
  client_choice       text,
  fedex_selection     jsonb,
  delivery_address    jsonb,
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
