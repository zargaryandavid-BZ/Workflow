-- Add column_id to job_notifications so each notification records which
-- board column the order was in when the note/notification was created.

alter table public.job_notifications
  add column if not exists column_id uuid references public.board_columns (id) on delete set null;

create index if not exists job_notifications_column_idx
  on public.job_notifications (column_id);
