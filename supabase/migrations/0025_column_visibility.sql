-- Column visibility: restrict which roles and/or specific users see a column.
-- Empty arrays (default) = visible to everyone.
-- Populated = only matching roles OR matching user IDs see it (admins always see all).

alter table public.board_columns
  add column if not exists visible_to_roles text[] not null default '{}';

alter table public.board_columns
  add column if not exists visible_to_users text[] not null default '{}';
