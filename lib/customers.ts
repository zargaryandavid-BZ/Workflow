import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
} from "@/lib/constants";

type Client = SupabaseClient;

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

export async function upsertCustomer(
  client: Client,
  tenantId: string,
  name: string,
  contact: string
): Promise<string> {
  const trimmedName = name.trim();
  const trimmedContact = contact.trim();
  const isEmail = trimmedContact.includes("@");
  const field = isEmail ? "email" : "phone";

  const { data: existing } = await client
    .from("customers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq(field, trimmedContact)
    .maybeSingle();

  if (existing) {
    const { error } = await client
      .from("customers")
      .update({
        name: trimmedName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return existing.id as string;
  }

  const { data: created, error } = await client
    .from("customers")
    .insert({
      tenant_id: tenantId,
      name: trimmedName,
      [field]: trimmedContact,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return created.id as string;
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
