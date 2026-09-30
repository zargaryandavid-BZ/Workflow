-- Prevent two simultaneously RUNNING Prepress timers for the same user.
-- "Running" = ended_at IS NULL AND paused_at IS NULL.
-- Paused entries (paused_at IS NOT NULL) are excluded and can coexist freely.
-- Designer timers (activity_type != 'Prepress') are unaffected.

-- Pause extras so the unique index can be created if a race already stored
-- two running Prepress rows for one user (keep the newest running).
update public.time_entries
set paused_at = now()
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by user_id
        order by started_at desc, created_at desc
      ) as rn
    from public.time_entries
    where activity_type = 'Prepress'
      and ended_at is null
      and paused_at is null
  ) ranked
  where rn > 1
);

create unique index if not exists time_entries_one_running_prepress_per_user
  on public.time_entries (user_id)
  where activity_type = 'Prepress'
    and ended_at is null
    and paused_at is null;
