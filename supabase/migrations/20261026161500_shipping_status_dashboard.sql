-- Shared tenant dashboard state for customer pickup / FedEx selections.

alter table public.shipping_requests
  add column if not exists shipping_status_seen_at timestamptz,
  add column if not exists shipping_status_removed_at timestamptz,
  add column if not exists shipping_status_removed_reason text;

-- Existing responses remain visible but are not mislabeled as newly received.
update public.shipping_requests
set shipping_status_seen_at = coalesce(responded_at, created_at)
where status = 'client_responded'
  and shipping_status_seen_at is null;

create index if not exists shipping_requests_status_dashboard_idx
  on public.shipping_requests (tenant_id, responded_at desc)
  where status = 'client_responded';
