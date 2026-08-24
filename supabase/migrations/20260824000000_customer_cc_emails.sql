-- 0075_customer_cc_emails
-- Additional approval/notification recipients (CC) saved on a customer so that
-- every future order for that customer pre-fills them. Additive + backward
-- compatible: existing rows default to an empty list.

alter table public.customers
  add column if not exists cc_emails text[] not null default '{}';
