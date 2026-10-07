/** Public FedEx tracking page for a shipment. */
export function fedexTrackingUrl(trackingNumber: string): string {
  const n = trackingNumber.trim();
  if (!n) return "";
  return `https://www.fedex.com/wtrk/track/?trknbr=${encodeURIComponent(n)}`;
}
