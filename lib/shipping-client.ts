/** Client-safe pickup address copy (mirrors FEDEX_SHIPPER_* defaults). */
export function pickupLocationLines(): string[] {
  return [
    "306 Boyd St",
    "Los Angeles, CA 90013",
    "Available for pickup: Mon–Fri 9:30 AM – 5:30 PM, Sat until 4:00 PM",
  ];
}
