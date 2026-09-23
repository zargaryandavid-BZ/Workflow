import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contactInputError,
  normalizeContactInput,
  type CustomerContact,
} from "@/lib/customer-contacts";

type Client = SupabaseClient;

export async function listCustomerContacts(
  client: Client,
  tenantId: string,
  customerId: string
): Promise<CustomerContact[]> {
  const { data, error } = await client
    .from("customer_contacts")
    .select("id, tenant_id, customer_id, name, email, phone, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerContact[];
}

export async function createCustomerContact(
  client: Client,
  tenantId: string,
  customerId: string,
  body: { name?: unknown; email?: unknown; phone?: unknown }
): Promise<CustomerContact> {
  const input = normalizeContactInput(body);
  const err = contactInputError(input);
  if (err) throw new Error(err);
  const name =
    input.name ||
    (input.email ? input.email.split("@")[0] : "") ||
    "Contact";

  const { data: customer, error: custErr } = await client
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (custErr) throw new Error(custErr.message);
  if (!customer) throw new Error("Customer not found");

  const { data, error } = await client
    .from("customer_contacts")
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      name,
      email: input.email,
      phone: input.phone,
    })
    .select("id, tenant_id, customer_id, name, email, phone, created_at, updated_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new Error("That email is already a contact for this company.");
    }
    throw new Error(error.message);
  }
  return data as CustomerContact;
}

export async function updateCustomerContact(
  client: Client,
  tenantId: string,
  customerId: string,
  contactId: string,
  body: { name?: unknown; email?: unknown; phone?: unknown }
): Promise<CustomerContact> {
  const input = normalizeContactInput(body);
  const err = contactInputError(input);
  if (err) throw new Error(err);
  const name =
    input.name ||
    (input.email ? input.email.split("@")[0] : "") ||
    "Contact";

  const { data, error } = await client
    .from("customer_contacts")
    .update({
      name,
      email: input.email,
      phone: input.phone,
    })
    .eq("id", contactId)
    .eq("customer_id", customerId)
    .eq("tenant_id", tenantId)
    .select("id, tenant_id, customer_id, name, email, phone, created_at, updated_at")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      throw new Error("That email is already a contact for this company.");
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error("Contact not found");
  return data as CustomerContact;
}

export async function deleteCustomerContact(
  client: Client,
  tenantId: string,
  customerId: string,
  contactId: string
): Promise<void> {
  const { data, error } = await client
    .from("customer_contacts")
    .delete()
    .eq("id", contactId)
    .eq("customer_id", customerId)
    .eq("tenant_id", tenantId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Contact not found");
}
