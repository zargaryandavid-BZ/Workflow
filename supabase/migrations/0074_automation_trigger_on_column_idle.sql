-- Idle-in-column automation: auto-move after a card sits too long.
alter type public.automation_trigger add value if not exists 'on_column_idle';
