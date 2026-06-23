-- Role-or-Individual Picker
-- Extends fast_action_buttons, notification_rules, and board_columns with
-- three new columns each so admins can restrict visibility/recipients by role
-- (all current + future members of that role) or by specific individuals.

-- ── fast_action_buttons ──────────────────────────────────────────────────────

alter table public.fast_action_buttons
  add column if not exists visibility_mode  text not null default 'all'
    check (visibility_mode in ('all', 'roles', 'individuals')),
  add column if not exists visibility_roles text[] not null default '{}',
  add column if not exists visibility_users uuid[] not null default '{}';

-- Keep existing visible_to_roles for backwards compat; new code uses the
-- three columns above.

-- ── notification_rules ───────────────────────────────────────────────────────

alter table public.notification_rules
  add column if not exists recipient_mode  text not null default 'roles'
    check (recipient_mode in ('all', 'roles', 'individuals')),
  add column if not exists recipient_roles text[] not null default '{}',
  add column if not exists recipient_users uuid[] not null default '{}';

-- Existing 'recipient' column (customer/staff/both) stays for customer
-- notifications. The new three columns apply to the staff side only.

-- ── board_columns ────────────────────────────────────────────────────────────

alter table public.board_columns
  add column if not exists visibility_mode  text not null default 'all'
    check (visibility_mode in ('all', 'roles', 'individuals')),
  add column if not exists visibility_roles text[] not null default '{}',
  add column if not exists visibility_users_v2 uuid[] not null default '{}';

-- Note: board_columns already has visible_to_roles text[] and
-- visible_to_users text[].  The new three columns replace them for new rows;
-- existing rows keep the old values as a fallback (handled in app code).
