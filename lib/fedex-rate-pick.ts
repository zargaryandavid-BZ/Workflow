export type RatedShipmentDetail = {
  rateType?: string;
  actualRateType?: string;
  totalNetCharge?: number | string | { amount?: number | string; currency?: string };
  currency?: string;
};

/**
 * Prefer the ACCOUNT-rated entry (the shipper's negotiated rate).
 *
 * We check only `rateType` — not `actualRateType`.  FedEx often echoes back
 * `actualRateType = "PAYOR_LIST_PACKAGE"` even on entries where
 * `rateType = "PAYOR_ACCOUNT_PACKAGE"` (it means no additional account
 * discount was applied on top of list for that service).  If we combined both
 * fields into a single string and then excluded any entry containing "LIST",
 * we would accidentally drop the ACCOUNT entry and fall back to details[0],
 * which may be the full-price LIST rate.
 */
export function pickRatedDetail(
  details: RatedShipmentDetail[] | undefined
): RatedShipmentDetail | undefined {
  if (!details?.length) return undefined;
  // Find the entry whose rateType is an ACCOUNT rate (e.g. PAYOR_ACCOUNT_PACKAGE).
  const account = details.find((d) =>
    (d.rateType ?? "").toUpperCase().includes("ACCOUNT")
  );
  if (account) return account;
  return details[0];
}
