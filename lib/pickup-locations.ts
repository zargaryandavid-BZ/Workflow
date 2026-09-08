/** Client + server helpers for ship-from / pickup addresses. */

export type ShippingPickupLocation = {
  id: string;
  tenant_id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  hours_note: string | null;
  use_for_fedex: boolean;
  position: number;
};

export type ShippingPickupLocationDraft = {
  id?: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
  hours_note: string;
  use_for_fedex: boolean;
};

export type StaffPickupLocation = {
  id: string;
  name: string;
  addressLine: string;
  hoursNote: string;
  useForFedex: boolean;
};

export function formatPickupAddressLine(loc: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const street = loc.street?.trim() ?? "";
  const city = loc.city?.trim() ?? "";
  const state = loc.state?.trim() ?? "";
  const zip = loc.zip?.trim() ?? "";
  const cityLine = [city, [state, zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [street, cityLine].filter(Boolean).join(", ");
}

/** SMS / email `{{pickup_location}}` — name plus street/city. */
export function formatPickupNotifyLocation(loc: {
  name?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const address = formatPickupAddressLine(loc);
  const name = loc.name?.trim() ?? "";
  if (name && address && !address.toLowerCase().startsWith(name.toLowerCase())) {
    return `${name} — ${address}`;
  }
  return address || name;
}

export function emptyPickupLocationDraft(
  useForFedex: boolean
): ShippingPickupLocationDraft {
  return {
    name: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    country: "US",
    hours_note: "",
    use_for_fedex: useForFedex,
  };
}

export function parsePickupLocationDrafts(
  raw: unknown
): { drafts: ShippingPickupLocationDraft[]; error: string | null } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { drafts: [], error: "Add at least one pickup location" };
  }

  const drafts: ShippingPickupLocationDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { drafts: [], error: "Invalid pickup location" };
    }
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : undefined;
    drafts.push({
      id,
      name: typeof row.name === "string" ? row.name : "",
      street: typeof row.street === "string" ? row.street : "",
      city: typeof row.city === "string" ? row.city : "",
      state: typeof row.state === "string" ? row.state : "",
      zip: typeof row.zip === "string" ? row.zip : "",
      country: typeof row.country === "string" ? row.country : "US",
      hours_note: typeof row.hours_note === "string" ? row.hours_note : "",
      use_for_fedex: Boolean(row.use_for_fedex),
    });
  }

  const fedexCount = drafts.filter((d) => d.use_for_fedex).length;
  if (fedexCount !== 1) {
    return {
      drafts: [],
      error: "Check exactly one location for FedEx rate calculation",
    };
  }

  return { drafts, error: null };
}

export function formatStaffPickupNotify(loc: StaffPickupLocation): string {
  return formatPickupNotifyLocation({
    name: loc.name,
    street: loc.addressLine,
  });
}

export function toStaffPickupLocation(
  loc: ShippingPickupLocation
): StaffPickupLocation {
  return {
    id: loc.id,
    name: loc.name.trim() || "Shop",
    addressLine: formatPickupAddressLine(loc),
    hoursNote: loc.hours_note?.trim() ?? "",
    useForFedex: loc.use_for_fedex,
  };
}
