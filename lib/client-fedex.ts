import type { FedExRateOption } from "@/lib/types";

/** Digits only, typical FedEx account length. */
export function normalizeFedExAccountNumber(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 12) return null;
  return digits;
}

export function maskFedExAccountNumber(account: string): string {
  const d = account.replace(/\D/g, "");
  if (d.length < 4) return "FedEx";
  return `••••${d.slice(-4)}`;
}

/** Stored on `shipping_requests.fedex_selection` when the client bills their account. */
export const CLIENT_FEDEX_SERVICE_TYPE = "CLIENT_ACCOUNT";

export function clientFedExSelection(account: string): FedExRateOption {
  const digits = normalizeFedExAccountNumber(account);
  if (!digits) {
    throw new Error("Enter a valid FedEx account number (8–12 digits).");
  }
  return {
    serviceType: CLIENT_FEDEX_SERVICE_TYPE,
    serviceName: "FedEx with my account",
    totalCharge: null,
    currency: "USD",
    deliveryDate: null,
    transitDays: null,
    provider: "fedex",
    clientAccountNumber: digits,
  };
}

export function isClientFedExSelection(
  rate: FedExRateOption | null | undefined
): boolean {
  if (!rate) return false;
  return (
    rate.serviceType === CLIENT_FEDEX_SERVICE_TYPE ||
    Boolean(normalizeFedExAccountNumber(rate.clientAccountNumber))
  );
}

export function clientFedExAccountFromSelection(
  rate: FedExRateOption | null | undefined
): string | null {
  if (!rate) return null;
  return (
    normalizeFedExAccountNumber(rate.clientAccountNumber) ??
    (rate.serviceType === CLIENT_FEDEX_SERVICE_TYPE
      ? normalizeFedExAccountNumber(rate.quoteId)
      : null)
  );
}
