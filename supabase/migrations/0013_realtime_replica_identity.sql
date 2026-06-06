-- Supabase Realtime with RLS needs FULL replica identity on subscribed tables.
-- Without this, UPDATE events (e.g. column_id change when a customer replies)
-- are not delivered to browser subscribers.
alter table public.orders replica identity full;
alter table public.job_notifications replica identity full;
