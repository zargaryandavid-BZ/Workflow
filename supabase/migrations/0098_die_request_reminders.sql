-- Manufacturer reminders: a request still "sent" (no price yet) gets a nudge
-- after a few days, a few times at most. Also a "Remind now" button.
alter table public.die_requests
  add column if not exists reminder_count integer not null default 0,
  add column if not exists last_reminder_at timestamptz;

-- History line "Reminder sent to <manufacturer>".
alter table public.die_events drop constraint if exists die_events_kind_check;
alter table public.die_events
  add constraint die_events_kind_check check (kind in (
    'added', 'ordered', 'received', 'used', 'returned',
    'status', 'reorder', 'edited', 'deleted', 'reminded'
  ));
