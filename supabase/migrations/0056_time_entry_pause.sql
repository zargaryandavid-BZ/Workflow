-- Pause/resume support for running time entries.

alter table public.time_entries
  add column if not exists paused_at timestamptz,
  add column if not exists paused_seconds integer not null default 0;

alter table public.time_entries
  drop constraint if exists time_entries_paused_seconds_nonneg;

alter table public.time_entries
  add constraint time_entries_paused_seconds_nonneg
  check (paused_seconds >= 0);

-- Cannot be paused after the entry has ended
alter table public.time_entries
  drop constraint if exists time_entries_pause_only_while_running;

alter table public.time_entries
  add constraint time_entries_pause_only_while_running
  check (paused_at is null or ended_at is null);
