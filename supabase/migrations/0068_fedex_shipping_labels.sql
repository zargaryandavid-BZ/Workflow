-- FedEx shipping labels: tracking + stored PDF after client pays for delivery.
-- Shipper contact fields required by FedEx Ship API (rates only need address).

alter table public.shipping_settings
  add column if not exists shipper_contact_name text,
  add column if not exists shipper_phone text;

alter table public.shipping_requests
  add column if not exists fedex_tracking_number text,
  add column if not exists fedex_label_storage_path text,
  add column if not exists fedex_shipment_status text,
  add column if not exists fedex_label_error text,
  add column if not exists fedex_shipped_at timestamptz;

alter table public.shipping_requests
  drop constraint if exists shipping_requests_fedex_shipment_status_check;

alter table public.shipping_requests
  add constraint shipping_requests_fedex_shipment_status_check
  check (
    fedex_shipment_status is null
    or fedex_shipment_status in ('pending', 'created', 'failed')
  );
