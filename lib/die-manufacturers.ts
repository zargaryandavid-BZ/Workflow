export type DieManufacturer = {
  id: string;
  tenant_id: string;
  full_name: string;
  contact_name: string | null;
  email: string;
  phone: string | null;
  contact_name_2: string | null;
  email_2: string | null;
  phone_2: string | null;
  created_at: string;
  updated_at?: string;
};

export type DieManufacturerContact = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function dieManufacturerLabel(m: {
  full_name: string;
  contact_name?: string | null;
}): string {
  const contact = m.contact_name?.trim();
  return contact ? `${m.full_name} · ${contact}` : m.full_name;
}

export function dieManufacturerContacts(
  m: Pick<
    DieManufacturer,
    | "contact_name"
    | "email"
    | "phone"
    | "contact_name_2"
    | "email_2"
    | "phone_2"
  >
): DieManufacturerContact[] {
  return [
    {
      name: m.contact_name?.trim() || null,
      email: m.email?.trim().toLowerCase() || null,
      phone: m.phone?.trim() || null,
    },
    {
      name: m.contact_name_2?.trim() || null,
      email: m.email_2?.trim().toLowerCase() || null,
      phone: m.phone_2?.trim() || null,
    },
  ].filter((c) => Boolean(c.email || c.phone));
}

function optionalEmail(raw: unknown): string | null | { error: string } {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email) return null;
  if (!isValidEmail(email)) return { error: "Enter a valid email." };
  return email;
}

export function parseDieManufacturerBody(body: unknown):
  | {
      full_name: string;
      contact_name: string | null;
      email: string;
      phone: string | null;
      contact_name_2: string | null;
      email_2: string | null;
      phone_2: string | null;
    }
  | { error: string } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const full_name = String(
    raw.full_name ?? raw.fullName ?? raw.company_name ?? raw.companyName ?? ""
  ).trim();
  const contact_name = String(
    raw.contact_name ?? raw.contactName ?? ""
  ).trim();
  const emailParsed = optionalEmail(raw.email);
  if (emailParsed && typeof emailParsed === "object" && "error" in emailParsed) {
    return emailParsed;
  }
  const email = (emailParsed as string | null) ?? "";
  const phoneRaw = String(raw.phone ?? "").trim();
  const contact_name_2 = String(
    raw.contact_name_2 ?? raw.contactName2 ?? ""
  ).trim();
  const email2Parsed = optionalEmail(raw.email_2 ?? raw.email2);
  if (email2Parsed && typeof email2Parsed === "object" && "error" in email2Parsed) {
    return { error: "Enter a valid second contact email." };
  }
  const email_2 = (email2Parsed as string | null) ?? null;
  const phone_2 = String(raw.phone_2 ?? raw.phone2 ?? "").trim() || null;

  if (!full_name) return { error: "Company name is required." };
  if (!email) return { error: "Email is required for contact 1." };
  if (!isValidEmail(email)) return { error: "Enter a valid email." };
  return {
    full_name,
    contact_name: contact_name || null,
    email,
    phone: phoneRaw || null,
    contact_name_2: contact_name_2 || null,
    email_2,
    phone_2,
  };
}

export function mapDieManufacturerRow(row: Record<string, unknown>): DieManufacturer {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    full_name: String(row.full_name),
    contact_name: row.contact_name ? String(row.contact_name) : null,
    email: String(row.email ?? ""),
    phone: row.phone ? String(row.phone) : null,
    contact_name_2: row.contact_name_2 ? String(row.contact_name_2) : null,
    email_2: row.email_2 ? String(row.email_2) : null,
    phone_2: row.phone_2 ? String(row.phone_2) : null,
    created_at: String(row.created_at),
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}
