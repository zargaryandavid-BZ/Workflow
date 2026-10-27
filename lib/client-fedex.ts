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
export const DEFAULT_CLIENT_FEDEX_SERVICE = "FEDEX_GROUND";

const CLIENT_FEDEX_SERVICE_NAMES: Record<string, string> = {
  FEDEX_GROUND: "FedEx Ground",
  FEDEX_2_DAY: "FedEx 2Day",
  STANDARD_OVERNIGHT: "FedEx Standard Overnight",
};

export const CLIENT_FEDEX_SERVICES = Object.entries(
  CLIENT_FEDEX_SERVICE_NAMES
).map(([value, label]) => ({ value, label }));

export function clientFedExSelection(
  account: string,
  clientServiceType = DEFAULT_CLIENT_FEDEX_SERVICE
): FedExRateOption {
  const digits = normalizeFedExAccountNumber(account);
  if (!digits) {
    throw new Error("Enter a valid FedEx account number (8–12 digits).");
  }
  const service =
    CLIENT_FEDEX_SERVICE_NAMES[clientServiceType] != null
      ? clientServiceType
      : DEFAULT_CLIENT_FEDEX_SERVICE;
  return {
    serviceType: CLIENT_FEDEX_SERVICE_TYPE,
    serviceName: CLIENT_FEDEX_SERVICE_NAMES[service]!,
    totalCharge: null,
    currency: "USD",
    deliveryDate: null,
    transitDays: null,
    provider: "fedex",
    clientAccountNumber: digits,
    clientServiceType: service,
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

/** Older saved client-account choices predate service selection; use Ground. */
export function clientFedExServiceFromSelection(
  rate: FedExRateOption | null | undefined
): string | null {
  if (!isClientFedExSelection(rate)) return null;
  const selected = rate?.clientServiceType?.trim();
  if (selected && CLIENT_FEDEX_SERVICE_NAMES[selected] != null) return selected;
  return DEFAULT_CLIENT_FEDEX_SERVICE;
}
