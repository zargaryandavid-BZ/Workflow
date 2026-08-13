-- Locked reference assets.
--
-- The image the CRM/manager attaches flows into the Workflow as an asset. It is
-- an INTERNAL reference only: designers must not delete or replace it, and it
-- must never be sent to the customer for approval. The designer's own proof
-- files are separate, customer-facing assets.
--
-- `is_locked = true` marks the internal reference. Webhook-ingested artwork is
-- stamped locked; designer uploads are not. Locked assets survive the
-- one-file-per-SKU replace, cannot be deleted via the asset routes, and are
-- excluded from every customer-facing artwork view.
alter table public.assets
  add column if not exists is_locked boolean not null default false;

comment on column public.assets.is_locked is
  'Internal reference asset (e.g. the CRM-attached image). Never deletable by designers, never shown to the customer.';
