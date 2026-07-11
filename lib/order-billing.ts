/** Billing / payment metadata from inbound webhooks → `orders.specs.billing`. */

export type PaymentStatus = "partial" | "full";

export interface OrderBillingInfo {
  source_url?: string | null;
  payment_status?: PaymentStatus | null;
  deposit?: number | null;
  balance?: number | null;
}

export function parsePaymentStatus(raw: unknown): PaymentStatus | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "partial") return "partial";
  if (v === "full" || v === "paid" || v === "complete") return "full";
  return null;
}

export function parseMoneyAmount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseSourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

/** Build billing object from webhook order- or item-level fields. */
export function parseWebhookBilling(input: {
  source_url?: unknown;
  payment_status?: unknown;
  deposit?: unknown;
  balance?: unknown;
  /** Aliases */
  payment?: unknown;
  source_link?: unknown;
  order_url?: unknown;
}): OrderBillingInfo | null {
  const source_url =
    parseSourceUrl(input.source_url) ??
    parseSourceUrl(input.source_link) ??
    parseSourceUrl(input.order_url);
  const payment_status =
    parsePaymentStatus(input.payment_status) ??
    parsePaymentStatus(input.payment);
  const deposit = parseMoneyAmount(input.deposit);
  const balance = parseMoneyAmount(input.balance);

  if (
    source_url == null &&
    payment_status == null &&
    deposit == null &&
    balance == null
  ) {
    return null;
  }

  return {
    source_url,
    payment_status,
    deposit,
    balance,
  };
}

export function billingFromSpecs(
  specs: Record<string, unknown> | null | undefined
): OrderBillingInfo | null {
  if (!specs || typeof specs !== "object") return null;
  const raw = specs.billing;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  return parseWebhookBilling({
    source_url: obj.source_url,
    payment_status: obj.payment_status,
    deposit: obj.deposit,
    balance: obj.balance,
  });
}

export function hasBillingInfo(billing: OrderBillingInfo | null | undefined): boolean {
  if (!billing) return false;
  return (
    Boolean(billing.source_url?.trim()) ||
    billing.payment_status != null ||
    billing.deposit != null ||
    billing.balance != null
  );
}

export function formatBillingMoney(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

export function paymentStatusLabel(status: PaymentStatus | null | undefined): string {
  if (status === "full") return "Full";
  if (status === "partial") return "Partial";
  return "—";
}
