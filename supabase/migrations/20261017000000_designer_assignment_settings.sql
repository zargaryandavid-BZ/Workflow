-- Designer auto-assignment + stale-transfer settings (Settings → Designers).
-- Additive, inert by default: nothing changes until an admin turns it on.
alter table tenants
  add column if not exists designer_autoassign_enabled boolean not null default false,
  add column if not exists designer_pool uuid[] not null default '{}',
  add column if not exists designer_stale_hours integer not null default 0,
  add column if not exists designer_working_days integer[] not null default '{1,2,3,4,5}';
