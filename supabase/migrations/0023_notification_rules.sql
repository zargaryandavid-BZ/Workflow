-- Column notification rules (auto email/SMS when a job enters a column) --------

create table if not exists public.notification_rules (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  name          text not null,
  column_id     uuid references public.board_columns (id) on delete cascade,
  send_email    boolean not null default true,
  send_sms      boolean not null default false,
  recipient     text not null default 'customer'
    check (recipient in ('customer', 'staff', 'both')),
  email_subject text not null default 'Your order {{order_number}} — status update',
  email_body    text not null default 'Hi {{customer_name}},

Your order {{order_number}} has moved to {{column_name}}.

Due date: {{due_date}}
Product: {{product}}

Questions? Reply to this email.

— BazaarPrinting',
  sms_body      text not null default 'Hi {{customer_name}}, your order {{order_number}} is now in {{column_name}}. Questions? Call us.',
  enabled       boolean not null default true,
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists notification_rules_tenant_idx
  on public.notification_rules (tenant_id, position);

create index if not exists notification_rules_column_idx
  on public.notification_rules (column_id);

alter table public.notification_rules enable row level security;

drop policy if exists "notification_rules_select_member" on public.notification_rules;
drop policy if exists "notification_rules_admin_write" on public.notification_rules;

create policy "notification_rules_select_member" on public.notification_rules
  for select using (public.is_tenant_member(tenant_id));
create policy "notification_rules_admin_write" on public.notification_rules
  for all using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
