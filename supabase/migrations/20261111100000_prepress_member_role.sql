-- New team member role: Pre-press.
-- Runs the Pre-press timer, sees/reorders the Pre-press Queue, opens Die Order,
-- and edits orders like a Designer. Column visibility / move rights are set per
-- column in Settings → Columns (like the other non-admin roles).
alter type public.member_role add value if not exists 'prepress';
