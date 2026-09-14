import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
} from "@/lib/constants";
import { parseCustomerContact } from "@/lib/notification-messages";
import type { ShippingDeliveryAddress } from "@/lib/types";

function pickField(
  fields: Record<string, unknown> | null | undefined,
  names: string[]
): string {
  if (!fields) return "";
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const [key, value] of Object.entries(fields)) {
    if (!wanted.has(key.toLowerCase())) continue;
    if (value == null || value === "") continue;
    return String(value).trim();
  }
  return "";
}

/** Parse "123 Main St, City, ST 90210" into address parts. */
function parseCombinedUsAddress(raw: string): Partial<ShippingDeliveryAddress> {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const zipMatch = trimmed.match(/,\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (!zipMatch) return { street: trimmed };

  const state = zipMatch[1].toUpperCase();
  const zip = zipMatch[2];
  const beforeState = trimmed.slice(0, zipMatch.index).trim();
  const commaParts = beforeState.split(",").map((p) => p.trim()).filter(Boolean);

  if (commaParts.length >= 2) {
    return {
      street: commaParts.slice(0, -1).join(", "),
      city: commaParts[commaParts.length - 1],
      state,
      zip,
    };
  }

  return { street: beforeState, state, zip };
}

function phoneFromOrderFields(
  orderFields: Record<string, unknown> | null | undefined
): string {
  const dedicated = pickField(orderFields, [
    "Phone",
    "Phone Number",
    "Contact Number",
    "Contact Phone",
    "Mobile",
    "Cell",
  ]);
  if (dedicated) return dedicated;

  const contactRaw = pickField(orderFields, [
    CUSTOMER_CONTACT_FIELD_NAME,
    "Customer Contact",
    "Contact",
  ]);
  return parseCustomerContact(contactRaw).phone ?? "";
}

function nameFromOrderFields(
  orderFields: Record<string, unknown> | null | undefined
): string {
  return pickField(orderFields, [
    CUSTOMER_NAME_FIELD_NAME,
    "Customer Name",
    "Contact Name",
    "Recipient Name",
    "Name",
  ]);
}

/** Suite / floor / unit usually means a business for FedEx Ground vs Home Delivery. */
export function streetSuggestsCommercial(street: string): boolean {
  return /\b(?:ste\.?|suite|unit|fl\.?|floor|bldg\.?|building)\b/i.test(
    street.trim()
  );
}

/** Home vs business. Suites default to business; the client can still check Residential. */
export function defaultResidentialFlag(
  street: string,
  saved?: boolean
): boolean {
  if (streetSuggestsCommercial(street)) return false;
  return saved !== false;
}

/** Trim + normalize a delivery address for API storage / carrier calls. */
export function normalizeDeliveryAddress(
  addr: ShippingDeliveryAddress
): ShippingDeliveryAddress {
  return {
    name: addr.name?.trim() || undefined,
    phone: addr.phone?.trim() || undefined,
    street: addr.street.trim(),
    city: addr.city.trim(),
    state: addr.state.trim().toUpperCase(),
    zip: addr.zip.trim(),
    country: (addr.country ?? "US").trim().toUpperCase() || "US",
    residential: addr.residential === true,
    usingOwnBox: addr.usingOwnBox !== false,
  };
}

/** Prefill delivery address from saved portal data or order custom fields. */
export function defaultDeliveryAddress(
  orderFields: Record<string, unknown> | null | undefined,
  saved?: ShippingDeliveryAddress | null,
  fallbacks?: { name?: string | null; phone?: string | null }
): ShippingDeliveryAddress {
  const base: ShippingDeliveryAddress = {
    name: saved?.name?.trim() ?? "",
    phone: saved?.phone?.trim() ?? "",
    street: saved?.street?.trim() ?? "",
    city: saved?.city?.trim() ?? "",
    state: saved?.state?.trim() ?? "",
    zip: saved?.zip?.trim() ?? "",
    country: saved?.country?.trim() || "US",
    residential: defaultResidentialFlag(
      saved?.street?.trim() ?? "",
      saved?.residential
    ),
    usingOwnBox: saved?.usingOwnBox !== false,
  };

  const fieldName =
    nameFromOrderFields(orderFields) || fallbacks?.name?.trim() || "";
  const fieldPhone =
    phoneFromOrderFields(orderFields) || fallbacks?.phone?.trim() || "";

  if (base.street && base.city && base.state && base.zip) {
    return {
      ...base,
      name: base.name || fieldName,
      phone: base.phone || fieldPhone,
    };
  }

  const street = pickField(orderFields, [
    "Street",
    "Address",
    "Shipping Address",
    "Ship To",
    "Delivery Address",
    "Ship To Address",
  ]);
  const city = pickField(orderFields, ["City"]);
  const state = pickField(orderFields, ["State"]);
  const zip = pickField(orderFields, ["ZIP", "Zip", "Zip Code", "Postal Code"]);

  if (street || city || state || zip) {
    return {
      ...base,
      name: base.name || fieldName,
      phone: base.phone || fieldPhone,
      street: base.street || street,
      city: base.city || city,
      state: base.state || state,
      zip: base.zip || zip,
      country: base.country || "US",
      residential: defaultResidentialFlag(
        base.street || street,
        saved?.residential
      ),
    };
  }

  const combined = pickField(orderFields, [
    "Full Address",
    "Shipping address",
    "Delivery address",
  ]);
  if (combined) {
    const parsed = parseCombinedUsAddress(combined);
    return {
      ...base,
      name: base.name || fieldName,
      phone: base.phone || fieldPhone,
      street: base.street || parsed.street || "",
      city: base.city || parsed.city || "",
      state: base.state || parsed.state || "",
      zip: base.zip || parsed.zip || "",
      country: base.country || "US",
      residential: defaultResidentialFlag(
        base.street || parsed.street || "",
        saved?.residential
      ),
    };
  }

  return {
    ...base,
    name: base.name || fieldName,
    phone: base.phone || fieldPhone,
  };
}
