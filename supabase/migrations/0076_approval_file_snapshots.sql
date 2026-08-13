-- Per-round approval file snapshots.
--
-- Each time an order is sent for customer approval, we freeze a copy of the
-- exact files that went out for THAT round. A later round (after a rejection)
-- gets its own frozen copy. This gives a permanent history: for every approval
-- round you can open the actual file the customer saw and its outcome
-- (rejected / approved), even after the designer has replaced the live file.
--
-- Shape: array of { file_name, mime_type, sku_key, storage_path, external_url }.
-- Frozen files are copied into the order-assets bucket under
-- approval-snapshots/<notification_id>/... . Additive; no behavior change until
-- a customer_approval round is created.
alter table public.job_notifications
  add column if not exists approval_files jsonb;

comment on column public.job_notifications.approval_files is
  'Frozen snapshot of the files sent for this approval round (see 0076).';
