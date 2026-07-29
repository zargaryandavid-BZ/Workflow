-- SMS conversation thread per order (outbound + inbound Twilio replies).

create table if not exists public.order_sms_messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  order_id        uuid not null references public.orders (id) on delete cascade,
  direction       text not null check (direction in ('outbound', 'inbound')),
  phone           text not null,
  body            text not null,
  twilio_sid      text,
  actor_user_id   uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create unique index if not exists order_sms_messages_twilio_sid_uidx
  on public.order_sms_messages (twilio_sid)
  where twilio_sid is not null;

create index if not exists order_sms_messages_order_idx
  on public.order_sms_messages (order_id, created_at asc);

create index if not exists order_sms_messages_phone_idx
  on public.order_sms_messages (tenant_id, phone, created_at desc);

alter table public.order_sms_messages enable row level security;

create policy "order_sms_messages_member_select"
  on public.order_sms_messages
  for select using (public.is_tenant_member(tenant_id));

create policy "order_sms_messages_member_insert"
  on public.order_sms_messages
  for insert with check (public.is_tenant_member(tenant_id));

comment on table public.order_sms_messages is
  'Outbound and inbound SMS for an order; inbound via Twilio webhook.';
