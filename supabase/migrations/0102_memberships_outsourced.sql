-- Mark a teammate as outsourced (external) for this tenant.
alter table public.memberships
  add column if not exists outsourced boolean not null default false;

comment on column public.memberships.outsourced is
  'When true, this member is an outsourced / external teammate.';
