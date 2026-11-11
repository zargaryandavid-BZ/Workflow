import type { FedExRateOption } from "@/lib/types";

/**
 * Free FedEx Ground on Bazaar website orders over $500 (Hayk 2026-11-08).
 * The website stamps `free_ground_shipping: true` on the order webhook; it is
 * saved on the card's specs. On the customer shipping link, FedEx Ground (and
 * Ground Home Delivery) then shows FREE and needs no payment. Other services
 * keep their normal price.
 */
export const FREE_GROUND_SERVICE_TYPES = ["FEDEX_GROUND", "GROUND_HOME_DELIVERY"] as const;

export function isGroundService(serviceType: string | null | undefined): boolean {
  return (FREE_GROUND_SERVICE_TYPES as readonly string[]).includes(String(serviceType ?? ""));
}

/** True when this rate is FedEx Ground billed to the shop (not Curri, not the customer's account). */
export function isFreeGroundEligibleRate(rate: Pick<FedExRateOption, "serviceType" | "provider" | "clientAccountNumber"> | null | undefined): boolean {
  if (!rate) return false;
  if (rate.provider && rate.provider !== "fedex") return false;
  if (rate.clientAccountNumber) return false;
  return isGroundService(rate.serviceType);
}

export function specsHaveFreeGround(specs: unknown): boolean {
  return Boolean(specs && typeof specs === "object" && (specs as Record<string, unknown>).free_ground_shipping === true);
}

/** Ground rates become $0 + flagged; everything else is unchanged. */
export function applyFreeGround(rates: FedExRateOption[], freeGround: boolean): FedExRateOption[] {
  if (!freeGround) return rates;
  return rates.map((rate) =>
    isFreeGroundEligibleRate(rate) && rate.totalCharge != null
      ? { ...rate, totalCharge: 0, freeShipping: true }
      : rate,
  );
}

type AdminLike = {
  from: (table: string) => any;
};

/** Reads the free-Ground flag from the order card behind a shipping request. */
export async function orderHasFreeGround(admin: AdminLike, orderId: string | null | undefined): Promise<boolean> {
  if (!orderId) return false;
  const { data } = await admin.from("orders").select("specs").eq("id", orderId).maybeSingle();
  return specsHaveFreeGround(data?.specs);
}
