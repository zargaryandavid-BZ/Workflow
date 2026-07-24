-- Client shipping portal: staff send box details + portal link; client chooses pickup or FedEx delivery.

create table if not exists public.shipping_requests (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  order_id         uuid not null references public.orders (id) on delete cascade,
  token            uuid not null unique default gen_random_uuid(),
  boxes            jsonb not null default '[]'::jsonb,
  status           text not null default 'pending'
                     check (status in ('pending', 'client_responded')),
  client_choice    text check (client_choice is null or client_choice in ('pickup', 'delivery')),
  fedex_selection  jsonb,
  delivery_address jsonb,
  sent_at          timestamptz,
  responded_at     timestamptz,
  expires_at       timestamptz default (now() + interval '7 days'),
  created_at       timestamptz not null default now()
);

create index if not exists shipping_requests_order_idx on public.shipping_requests (order_id);
create index if not exists shipping_requests_tenant_idx on public.shipping_requests (tenant_id);
create index if not exists shipping_requests_token_idx on public.shipping_requests (token);

alter table public.shipping_requests enable row level security;

drop policy if exists "shipping_requests_member_all" on public.shipping_requests;
create policy "shipping_requests_member_all" on public.shipping_requests
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Public portal reads via security-definer RPC (anon cannot SELECT the table directly).
-- Must DROP first: CREATE OR REPLACE cannot change OUT/return row type (42P13).
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
  tenant_name         text
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
    t.name
  from public.shipping_requests sr
  join public.orders o on o.id = sr.order_id
  join public.tenants t on t.id = sr.tenant_id
  where sr.token = p_token;
$$;

grant execute on function public.get_shipping_request_by_token(uuid) to anon, authenticated;
