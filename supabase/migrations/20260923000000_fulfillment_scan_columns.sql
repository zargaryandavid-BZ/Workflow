-- Add scan_column_config to fulfillment_settings.
-- JSON: { buttons: [{ id, label, column_id }] } — Scan page action buttons.
-- Legacy map { received, delivered, shipped, finished, finished_reviewed } is still read.

ALTER TABLE public.fulfillment_settings
  ADD COLUMN IF NOT EXISTS scan_column_config jsonb DEFAULT '{}'::jsonb;
