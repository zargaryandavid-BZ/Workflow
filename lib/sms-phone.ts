/**
 * NANP area codes that are not in service. Prefixing +1 onto an international
 * number often produces these (322 = Belgium +32 with a US 1 in front).
 * @see https://en.wikipedia.org/wiki/List_of_North_American_Numbering_Plan_area_codes
 */
const NANP_NPA_NOT_IN_SERVICE = new Set(["322", "333"]);

function nanpProblem(e164: string): string | null {
  if (!e164.startsWith("+1")) return null;
  const national = e164.slice(2);
  if (national.length !== 10) {
    return `${e164} is not a valid US/Canada number (need +1 and 10 digits).`;
  }
  const npa = national.slice(0, 3);
  const exchange = national.slice(3, 6);
  const npaLead = npa[0];
  const exchangeLead = exchange[0];
  if (
    !npaLead ||
    npaLead < "2" ||
    npaLead > "9" ||
    !exchangeLead ||
    exchangeLead < "2" ||
    exchangeLead > "9"
  ) {
    return `${e164} is not a valid US/Canada mobile number.`;
  }
  if (npa[1] === "1" && npa[2] === "1") {
    return `${e164} uses an N11 code, not a mobile area code.`;
  }
  if (NANP_NPA_NOT_IN_SERVICE.has(npa)) {
    return `${e164} is not reachable — area code ${npa} is not in service. If this is an international number, enter the country code directly (for example +32…) with no extra 1.`;
  }
  return null;
}

/** Reject emails and other non-phone values before calling Twilio. */
export function validateSmsRecipient(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Phone number is required for SMS.";
  if (value.includes("@")) {
    return "SMS requires a phone number, not an email address.";
  }
  if (/x/i.test(value)) {
    return "Phone number is incomplete. Enter the full number, not a masked one.";
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) {
    return "Enter a valid phone number (at least 10 digits, e.g. +1 818 555 1234).";
  }
  return nanpProblem(normalizeSmsPhone(value));
}

/** Normalize to E.164; US numbers without country code get +1. */
export function normalizeSmsPhone(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("+")) {
    return `+${value.slice(1).replace(/\D/g, "")}`;
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Display-only formatting for a US/Canada number: "+13057803590" -> "+1 305-780-3590".
 * Never used for sending/storage — always read/write the raw value for that.
 * Anything that isn't a clean 10 or 11-digit NANP number is returned unchanged.
 */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const national = digits.slice(1);
    return `+1 ${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}
