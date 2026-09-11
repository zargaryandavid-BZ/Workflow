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
