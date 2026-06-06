import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
} from "@/lib/constants";
import { normalizeSmsPhone } from "@/lib/sms";
import type { Customer } from "@/lib/types";

type Client = SupabaseClient;

export type CustomerContactKind = "email" | "phone";

export function normalizeCustomerContact(
  contact: string
): { kind: CustomerContactKind; value: string } | null {
  const trimmed = contact.trim();
  if (!trimmed) return null;

  if (trimmed.includes("@")) {
    return { kind: "email", value: trimmed.toLowerCase() };
  }

  return { kind: "phone", value: normalizeSmsPhone(trimmed) };
}

export async function resolveCustomerFieldIds(
  client: Client,
  tenantId: string
): Promise<{ nameId: string | null; contactId: string | null }> {
  const { data } = await client
    .from("custom_fields")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .in("name", [CUSTOMER_NAME_FIELD_NAME, CUSTOMER_CONTACT_FIELD_NAME]);

  const byName = new Map(
    ((data ?? []) as { id: string; name: string }[]).map((f) => [
      f.name,
      f.id,
    ])
  );

  return {
    nameId: byName.get(CUSTOMER_NAME_FIELD_NAME) ?? null,
    contactId: byName.get(CUSTOMER_CONTACT_FIELD_NAME) ?? null,
  };
}

export function customerFromFieldValues(
  fieldIds: { nameId: string | null; contactId: string | null },
  values: { customFieldId: string; value: unknown }[]
): { name: string; contact: string } | null {
  if (!fieldIds.nameId || !fieldIds.contactId) return null;

  const byId = new Map(values.map((v) => [v.customFieldId, v.value]));
  const name = String(byId.get(fieldIds.nameId) ?? "").trim();
  const contact = String(byId.get(fieldIds.contactId) ?? "").trim();
  if (!name || !contact) return null;

  return { name, contact };
}

type CustomerCandidate = { id: string; created_at: string };

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

async function orderCountByCustomer(
  client: Client,
  tenantId: string,
  customerIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (customerIds.length === 0) return counts;

  const { data } = await client
    .from("orders")
    .select("customer_id")
    .eq("tenant_id", tenantId)
    .in("customer_id", customerIds);

  for (const row of (data ?? []) as { customer_id: string | null }[]) {
    if (!row.customer_id) continue;
    counts.set(row.customer_id, (counts.get(row.customer_id) ?? 0) + 1);
  }
  return counts;
}

function pickCanonicalCustomer<T extends CustomerCandidate>(
  rows: T[],
  orderCounts: Map<string, number>
): T {
  return rows.slice().sort((a, b) => {
    const ca = orderCounts.get(a.id) ?? 0;
    const cb = orderCounts.get(b.id) ?? 0;
    if (cb !== ca) return cb - ca;
    return a.created_at.localeCompare(b.created_at);
  })[0];
}

async function mergeDuplicateCustomers(
  client: Client,
  tenantId: string,
  canonicalId: string,
  duplicateIds: string[]
): Promise<void> {
  if (duplicateIds.length === 0) return;

  const { error: orderError } = await client
    .from("orders")
    .update({ customer_id: canonicalId })
    .eq("tenant_id", tenantId)
    .in("customer_id", duplicateIds);
  if (orderError) throw new Error(orderError.message);

  const { error: deleteError } = await client
    .from("customers")
    .delete()
    .in("id", duplicateIds);
  if (deleteError) throw new Error(deleteError.message);
}

export async function findCustomerByContact(
  client: Client,
  tenantId: string,
  contact: string
): Promise<Customer | null> {
  const normalized = normalizeCustomerContact(contact);
  if (!normalized) return null;

  const field = normalized.kind === "email" ? "email" : "phone";
  const { data, error } = await client
    .from("customers")
    .select("id, tenant_id, name, email, phone, company, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq(field, normalized.value);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Customer[];
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];

  const orderCounts = await orderCountByCustomer(
    client,
    tenantId,
    rows.map((r) => r.id)
  );
  const canonical = pickCanonicalCustomer(rows, orderCounts);
  const duplicateIds = rows
    .filter((r) => r.id !== canonical.id)
    .map((r) => r.id);
  await mergeDuplicateCustomers(client, tenantId, canonical.id, duplicateIds);

  const { data: refreshed, error: refreshError } = await client
    .from("customers")
    .select("id, tenant_id, name, email, phone, company, created_at, updated_at")
    .eq("id", canonical.id)
    .maybeSingle();
  if (refreshError) throw new Error(refreshError.message);
  return (refreshed as Customer | null) ?? canonical;
}

export async function upsertCustomer(
  client: Client,
  tenantId: string,
  name: string,
  contact: string
): Promise<string> {
  const trimmedName = name.trim();
  const normalized = normalizeCustomerContact(contact);
  if (!normalized) {
    throw new Error("Customer contact is required");
  }

  const field = normalized.kind === "email" ? "email" : "phone";
  const contactValue = normalized.value;

  const { data: matches, error: findError } = await client
    .from("customers")
    .select("id, created_at")
    .eq("tenant_id", tenantId)
    .eq(field, contactValue);

  if (findError) throw new Error(findError.message);

  const existing = (matches ?? []) as { id: string; created_at: string }[];

  if (existing.length > 0) {
    const orderCounts = await orderCountByCustomer(
      client,
      tenantId,
      existing.map((r) => r.id)
    );
    const canonical = pickCanonicalCustomer(existing, orderCounts);
    const duplicateIds = existing
      .filter((r) => r.id !== canonical.id)
      .map((r) => r.id);

    if (duplicateIds.length > 0) {
      await mergeDuplicateCustomers(
        client,
        tenantId,
        canonical.id,
        duplicateIds
      );
    }

    const { error: updateError } = await client
      .from("customers")
      .update({ name: trimmedName })
      .eq("id", canonical.id);
    if (updateError) throw new Error(updateError.message);
    return canonical.id;
  }

  const { data: created, error: insertError } = await client
    .from("customers")
    .insert({
      tenant_id: tenantId,
      name: trimmedName,
      [field]: contactValue,
    })
    .select("id")
    .single();

  if (!insertError && created) {
    return created.id as string;
  }

  if (isUniqueViolation(insertError)) {
    const existingAfterConflict = await findCustomerByContact(
      client,
      tenantId,
      contact
    );
    if (!existingAfterConflict) {
      throw new Error(insertError?.message ?? "Failed to save customer");
    }

    const { error: updateError } = await client
      .from("customers")
      .update({ name: trimmedName })
      .eq("id", existingAfterConflict.id);
    if (updateError) throw new Error(updateError.message);
    return existingAfterConflict.id;
  }

  throw new Error(insertError?.message ?? "Failed to save customer");
}

export async function linkCustomerFromOrderFields(
  client: Client,
  tenantId: string,
  customFieldValues: { customFieldId: string; value: unknown }[]
): Promise<string | null> {
  const fieldIds = await resolveCustomerFieldIds(client, tenantId);
  const parsed = customerFromFieldValues(fieldIds, customFieldValues);
  if (!parsed) return null;
  return upsertCustomer(client, tenantId, parsed.name, parsed.contact);
}
