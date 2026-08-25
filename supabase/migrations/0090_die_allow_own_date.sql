-- Staff can allow the manufacturer to offer a different due date (off by default).

alter table public.die_requests
  add column if not exists allow_own_date boolean not null default false;
