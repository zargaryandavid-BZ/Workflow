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

/** Website free-Ground threshold (same $500 as the website cart). */
export const FREE_GROUND_MIN_TOTAL = 500;

/**
 * Hayk 2026-11-27 (W511, $1,148.67, Nov 3): website orders placed before the
 * website started sending the free-Ground flag must get it too. A WEBSITE
 * (non-broker) order whose order total on the card (billing deposit + balance)
 * is $500+ qualifies, even without the flag.
 */
export function orderQualifiesForFreeGround(order: {
  webhook_source?: string | null;
  specs?: unknown;
}): boolean {
  if (specsHaveFreeGround(order.specs)) return true;
  if (String(order.webhook_source ?? "").trim().toLowerCase() !== "website") return false;
  const specs = (order.specs ?? {}) as Record<string, unknown>;
  if (specs.bazaar_broker_id || specs.bazaar_broker_slug) return false;
  const billing = (specs.billing ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  const deposit = num(billing.deposit);
  const balance = num(billing.balance);
  const total =
    (Number.isFinite(deposit) ? deposit : 0) + (Number.isFinite(balance) ? balance : 0);
  return total >= FREE_GROUND_MIN_TOTAL;
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
  const { data } = await admin
    .from("orders")
    .select("specs, webhook_source")
    .eq("id", orderId)
    .maybeSingle();
  return data ? orderQualifiesForFreeGround(data) : false;
}
