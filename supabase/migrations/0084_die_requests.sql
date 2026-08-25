-- Die requests: staff send a quote link; client returns price, time, confirmed due date.

create table if not exists public.die_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  width numeric,
  height numeric,
  required_date date not null,
  to_email text not null,
  file_path text,
  file_name text,
  file_mime text,
  status text not null default 'sent'
    check (status in ('sent', 'quoted')),
  quoted_price numeric,
  time_estimate text,
  confirmed_due_date date,
  client_note text,
  sent_at timestamptz not null default now(),
  quoted_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists die_requests_tenant_idx on public.die_requests (tenant_id);
create index if not exists die_requests_order_idx on public.die_requests (order_id);
create index if not exists die_requests_token_idx on public.die_requests (token);
create index if not exists die_requests_confirmed_due_idx
  on public.die_requests (confirmed_due_date)
  where status = 'quoted';

alter table public.die_requests enable row level security;

drop policy if exists "die_requests_member_all" on public.die_requests;
create policy "die_requests_member_all" on public.die_requests
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
