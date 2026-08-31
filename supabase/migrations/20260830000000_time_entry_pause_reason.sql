-- Pause reason for time entries: when a designer pauses, they must say why
-- (jumped to another job / break / waiting / customer rejection) so break time
-- can't hide as work time in the reports. Additive + nullable — legacy rows and
-- the resume action leave it null.

alter table public.time_entries
  add column if not exists pause_reason text;
