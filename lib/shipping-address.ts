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

/** Prefill delivery address from saved portal data or order custom fields. */
export function defaultDeliveryAddress(
  orderFields: Record<string, unknown> | null | undefined,
  saved?: ShippingDeliveryAddress | null
): ShippingDeliveryAddress {
  const base: ShippingDeliveryAddress = {
    street: saved?.street?.trim() ?? "",
    city: saved?.city?.trim() ?? "",
    state: saved?.state?.trim() ?? "",
    zip: saved?.zip?.trim() ?? "",
    country: saved?.country?.trim() || "US",
  };

  if (base.street && base.city && base.state && base.zip) {
    return base;
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
      street: base.street || street,
      city: base.city || city,
      state: base.state || state,
      zip: base.zip || zip,
      country: base.country || "US",
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
      street: base.street || parsed.street || "",
      city: base.city || parsed.city || "",
      state: base.state || parsed.state || "",
      zip: base.zip || parsed.zip || "",
      country: base.country || "US",
    };
  }

  return base;
}
