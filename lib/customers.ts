import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
} from "@/lib/constants";
import { normalizeSmsPhone } from "@/lib/sms";
import type { Customer, PreferredChannel } from "@/lib/types";
import { normalizePreferredChannel } from "@/lib/preferred-channel";

type Client = SupabaseClient;

export type CustomerContactKind = "email" | "phone";
export type UpsertCustomerAction = "created" | "updated" | "merged";

export interface UpsertCustomerInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  existingCustomerId?: string | null;
}

export interface UpsertCustomerResult {
  customerId: string;
  action: UpsertCustomerAction;
}

const CUSTOMER_SELECT =
  "id, tenant_id, name, email, phone, company, preferred_channel, created_at, updated_at";

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

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || null;
}

function normalizePhone(phone: string | null | undefined): string | null {
  const trimmed = phone?.trim();
  if (!trimmed) return null;
  return normalizeSmsPhone(trimmed);
}

function customerDataScore(customer: Customer): number {
  let score = 0;
  if (customer.name?.trim()) score += 1;
  if (customer.email) score += 1;
  if (customer.phone) score += 1;
  if (customer.company) score += 1;
  return score;
}

export async function resolveCustomerFieldIds(
  client: Client,
  tenantId: string
): Promise<{ nameId: string | null; contactId: string | null }> {
  const { data } = await client
    .from("custom_fields")
    .select("id, name")
    .eq("tenant_id", tenantId);

  let nameId: string | null = null;
  let contactId: string | null = null;
  for (const row of (data ?? []) as { id: string; name: string }[]) {
    const lower = row.name.toLowerCase();
    if (lower === CUSTOMER_NAME_FIELD_NAME.toLowerCase()) nameId = row.id;
    if (lower === CUSTOMER_CONTACT_FIELD_NAME.toLowerCase()) {
      contactId = row.id;
    }
  }

  return { nameId, contactId };
}

export function customerFromFieldValues(
  fieldIds: { nameId: string | null; contactId: string | null },
  values: { customFieldId: string; value: unknown }[]
): { name: string; email: string | null; phone: string | null } | null {
  if (!fieldIds.nameId || !fieldIds.contactId) return null;

  const byId = new Map(values.map((v) => [v.customFieldId, v.value]));
  const name = String(byId.get(fieldIds.nameId) ?? "").trim();
  const contact = String(byId.get(fieldIds.contactId) ?? "").trim();
  if (!name || !contact) return null;

  const normalized = normalizeCustomerContact(contact);
  if (!normalized) return null;

  return {
    name,
    email: normalized.kind === "email" ? normalized.value : null,
    phone: normalized.kind === "phone" ? normalized.value : null,
  };
}

type CustomerCandidate = Customer & { created_at: string };

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

function pickCanonicalCustomer(
  rows: Customer[],
  orderCounts: Map<string, number>
): Customer {
  return rows.slice().sort((a, b) => {
    const ca = orderCounts.get(a.id) ?? 0;
    const cb = orderCounts.get(b.id) ?? 0;
    if (cb !== ca) return cb - ca;
    const sa = customerDataScore(a);
    const sb = customerDataScore(b);
    if (sb !== sa) return sb - sa;
    return a.created_at.localeCompare(b.created_at);
  })[0];
}

async function loadCustomerById(
  client: Client,
  customerId: string
): Promise<Customer | null> {
  const { data, error } = await client
    .from("customers")
    .select(CUSTOMER_SELECT)
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Customer | null) ?? null;
}

async function findCustomerByEmail(
  client: Client,
  tenantId: string,
  email: string
): Promise<Customer | null> {
  const { data, error } = await client
    .from("customers")
    .select(CUSTOMER_SELECT)
    .eq("tenant_id", tenantId)
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Customer | null) ?? null;
}

async function findCustomerByPhone(
  client: Client,
  tenantId: string,
  phone: string
): Promise<Customer | null> {
  const { data, error } = await client
    .from("customers")
    .select(CUSTOMER_SELECT)
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Customer | null) ?? null;
}

async function mergeCustomers(
  client: Client,
  tenantId: string,
  winner: Customer,
  loser: Customer,
  incoming: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
  },
  orderId?: string | null
): Promise<Customer> {
  const updates: Record<string, string | null> = {};

  const email = incoming.email ?? loser.email ?? winner.email;
  const phone = incoming.phone ?? loser.phone ?? winner.phone;
  const name =
    incoming.name?.trim() ||
    (winner.name?.trim() ? winner.name : null) ||
    loser.name?.trim() ||
    winner.name;
  const company = incoming.company ?? loser.company ?? winner.company;

  if (email && winner.email !== email) updates.email = email;
  if (phone && winner.phone !== phone) updates.phone = phone;
  if (name && !winner.name?.trim()) updates.name = name;
  if (company && !winner.company) updates.company = company;

  // Free unique contact keys on the loser BEFORE applying them to the winner,
  // otherwise Postgres rejects the update with customers_tenant_phone/email_unique.
  const clearLoser: Record<string, null> = {};
  if (updates.email && loser.email && loser.email === updates.email) {
    clearLoser.email = null;
  }
  if (updates.phone && loser.phone && loser.phone === updates.phone) {
    clearLoser.phone = null;
  }
  if (Object.keys(clearLoser).length > 0) {
    const { error: clearError } = await client
      .from("customers")
      .update(clearLoser)
      .eq("id", loser.id);
    if (clearError) throw new Error(clearError.message);
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await client
      .from("customers")
      .update(updates)
      .eq("id", winner.id);
    if (error) throw new Error(error.message);
  }

  const { error: orderError } = await client
    .from("orders")
    .update({ customer_id: winner.id })
    .eq("tenant_id", tenantId)
    .eq("customer_id", loser.id);
  if (orderError) throw new Error(orderError.message);

  const { error: deleteError } = await client
    .from("customers")
    .delete()
    .eq("id", loser.id);
  if (deleteError) throw new Error(deleteError.message);

  await client.from("activity_log").insert({
    tenant_id: tenantId,
    order_id: orderId ?? null,
    actor: null,
    action: "customer_merged",
    metadata: {
      winner_id: winner.id,
      loser_id: loser.id,
      winner_name: winner.name,
      loser_name: loser.name,
    },
  });

  const refreshed = await loadCustomerById(client, winner.id);
  return refreshed ?? { ...winner, ...updates };
}

/** If an update hits a unique contact conflict, merge with the other row. */
async function updateCustomerHandlingUnique(
  client: Client,
  tenantId: string,
  existing: Customer,
  input: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
  },
  orderId?: string | null
): Promise<{ customerId: string; action: UpsertCustomerAction }> {
  const updates = buildCustomerUpdates(existing, input);
  if (Object.keys(updates).length === 0) {
    return { customerId: existing.id, action: "updated" };
  }

  const { error } = await client
    .from("customers")
    .update(updates)
    .eq("id", existing.id);

  if (!error) {
    return { customerId: existing.id, action: "updated" };
  }

  if (!isUniqueViolation(error)) {
    throw new Error(error.message);
  }

  // Look up the other row that still owns the contact (do not auto-merge here).
  let conflict: Customer | null = null;
  if (typeof updates.phone === "string" && updates.phone) {
    conflict = await findCustomerByPhone(client, tenantId, updates.phone);
  }
  if (!conflict && typeof updates.email === "string" && updates.email) {
    conflict = await findCustomerByEmail(client, tenantId, updates.email);
  }

  if (!conflict || conflict.id === existing.id) {
    throw new Error(error.message);
  }

  const orderCounts = await orderCountByCustomer(client, tenantId, [
    existing.id,
    conflict.id,
  ]);
  const winner = pickCanonicalCustomer([existing, conflict], orderCounts);
  const loser = winner.id === existing.id ? conflict : existing;
  const merged = await mergeCustomers(
    client,
    tenantId,
    winner,
    loser,
    {
      name: input.name,
      email: input.email,
      phone: input.phone,
      company: input.company,
    },
    orderId
  );

  return { customerId: merged.id, action: "merged" };
}

function buildCustomerUpdates(
  existing: Customer,
  input: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
  }
): Record<string, string | null> {
  const updates: Record<string, string | null> = {};
  const name = input.name?.trim();

  if (input.email && existing.email !== input.email) {
    updates.email = input.email;
  }
  if (input.phone && existing.phone !== input.phone) {
    updates.phone = input.phone;
  }
  if (name && !existing.name?.trim()) {
    updates.name = name;
  }
  if (input.company && !existing.company) {
    updates.company = input.company;
  }

  return updates;
}

export async function findCustomerByContacts(
  client: Client,
  tenantId: string,
  contacts: { email?: string | null; phone?: string | null }
): Promise<Customer | null> {
  const email = normalizeEmail(contacts.email);
  const phone = normalizePhone(contacts.phone);
  if (!email && !phone) return null;

  const [emailMatch, phoneMatch] = await Promise.all([
    email ? findCustomerByEmail(client, tenantId, email) : null,
    phone ? findCustomerByPhone(client, tenantId, phone) : null,
  ]);

  if (emailMatch && phoneMatch && emailMatch.id !== phoneMatch.id) {
    const orderCounts = await orderCountByCustomer(client, tenantId, [
      emailMatch.id,
      phoneMatch.id,
    ]);
    const winner = pickCanonicalCustomer([emailMatch, phoneMatch], orderCounts);
    const loser = winner.id === emailMatch.id ? phoneMatch : emailMatch;
    return mergeCustomers(client, tenantId, winner, loser, { email, phone });
  }

  return emailMatch ?? phoneMatch;
}

export async function findCustomerByContact(
  client: Client,
  tenantId: string,
  contact: string
): Promise<Customer | null> {
  const normalized = normalizeCustomerContact(contact);
  if (!normalized) return null;

  return findCustomerByContacts(
    client,
    tenantId,
    normalized.kind === "email"
      ? { email: normalized.value }
      : { phone: normalized.value }
  );
}

export async function upsertCustomer(
  client: Client,
  tenantId: string,
  input: UpsertCustomerInput,
  orderId?: string | null
): Promise<UpsertCustomerResult> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const name = input.name?.trim();

  if (!email && !phone) {
    throw new Error(
      "At least one of email or phone is required to upsert customer"
    );
  }

  const [emailMatch, phoneMatch, linkedCustomer] = await Promise.all([
    email ? findCustomerByEmail(client, tenantId, email) : null,
    phone ? findCustomerByPhone(client, tenantId, phone) : null,
    input.existingCustomerId
      ? loadCustomerById(client, input.existingCustomerId)
      : null,
  ]);

  const distinctMatches = new Map<string, Customer>();
  for (const row of [emailMatch, phoneMatch, linkedCustomer]) {
    if (row) distinctMatches.set(row.id, row);
  }
  const matches = Array.from(distinctMatches.values());

  if (matches.length > 1) {
    const orderCounts = await orderCountByCustomer(
      client,
      tenantId,
      matches.map((m) => m.id)
    );
    let winner = pickCanonicalCustomer(matches, orderCounts);

    for (const loser of matches.filter((m) => m.id !== winner.id)) {
      winner = await mergeCustomers(
        client,
        tenantId,
        winner,
        loser,
        { name, email, phone, company: input.company },
        orderId
      );
    }

    const afterMerge = await updateCustomerHandlingUnique(
      client,
      tenantId,
      winner,
      { name, email, phone, company: input.company },
      orderId
    );
    return {
      customerId: afterMerge.customerId,
      action: "merged",
    };
  }

  const existing = matches[0] ?? null;

  if (existing) {
    return updateCustomerHandlingUnique(
      client,
      tenantId,
      existing,
      { name, email, phone, company: input.company },
      orderId
    );
  }

  const { data: created, error: insertError } = await client
    .from("customers")
    .insert({
      tenant_id: tenantId,
      name: name ?? "",
      email,
      phone,
      company: input.company ?? null,
    })
    .select("id")
    .single();

  if (!insertError && created) {
    return { customerId: created.id as string, action: "created" };
  }

  if (isUniqueViolation(insertError)) {
    const afterConflict = await findCustomerByContacts(client, tenantId, {
      email,
      phone,
    });
    if (!afterConflict) {
      throw new Error(insertError?.message ?? "Failed to save customer");
    }

    return updateCustomerHandlingUnique(
      client,
      tenantId,
      afterConflict,
      { name, email, phone, company: input.company },
      orderId
    );
  }

  throw new Error(insertError?.message ?? "Failed to save customer");
}

export async function linkCustomerFromOrderFields(
  client: Client,
  tenantId: string,
  customFieldValues: { customFieldId: string; value: unknown }[],
  existingCustomerId?: string | null,
  orderId?: string | null
): Promise<string | null> {
  const fieldIds = await resolveCustomerFieldIds(client, tenantId);
  const parsed = customerFromFieldValues(fieldIds, customFieldValues);
  if (!parsed) return null;

  const { customerId } = await upsertCustomer(
    client,
    tenantId,
    {
      name: parsed.name,
      email: parsed.email,
      phone: parsed.phone,
      existingCustomerId,
    },
    orderId
  );
  return customerId;
}

/** Sync customer contact from notification overrides onto the order's customer. */
export async function syncCustomerFromNotification(
  client: Client,
  params: {
    tenantId: string;
    orderId: string;
    customerId: string | null;
    customerName?: string | null;
    customerEmail?: string | null;
    customerPhone?: string | null;
    toEmail?: string | null;
    toPhone?: string | null;
  }
): Promise<string | null> {
  let name = params.customerName?.trim() || undefined;
  let email = normalizeEmail(params.toEmail ?? params.customerEmail);
  let phone = normalizePhone(params.toPhone ?? params.customerPhone);

  if (params.customerId) {
    const existing = await loadCustomerById(client, params.customerId);
    if (existing) {
      name = name || existing.name?.trim() || undefined;
      email = email ?? normalizeEmail(existing.email);
      phone = phone ?? normalizePhone(existing.phone);
    }
  }

  if (!email && !phone) return params.customerId;

  const { customerId } = await upsertCustomer(
    client,
    params.tenantId,
    {
      name,
      email,
      phone,
      existingCustomerId: params.customerId,
    },
    params.orderId
  );

  if (customerId !== params.customerId) {
    const { error } = await client
      .from("orders")
      .update({ customer_id: customerId })
      .eq("id", params.orderId)
      .eq("tenant_id", params.tenantId);
    if (error) throw new Error(error.message);
  }

  return customerId;
}

export interface AdminCustomerUpdateInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  preferred_channel?: PreferredChannel | null;
}

export function validateAdminCustomerUpdate(
  input: AdminCustomerUpdateInput
): string | null {
  if (!input.name.trim()) return "Customer name is required";

  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  if (!email && !phone) return "Email or phone is required";

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Invalid email address";
  }

  if (
    input.preferred_channel != null &&
    input.preferred_channel !== "sms" &&
    input.preferred_channel !== "email"
  ) {
    return "Preferred channel must be SMS or Email";
  }

  return null;
}

async function syncOrdersCustomerFields(
  client: Client,
  tenantId: string,
  customerId: string,
  name: string,
  email: string | null,
  phone: string | null
): Promise<void> {
  const fieldIds = await resolveCustomerFieldIds(client, tenantId);
  if (!fieldIds.nameId && !fieldIds.contactId) return;

  const contact = email ?? phone;
  if (!contact) return;

  const { data: orders, error: ordersError } = await client
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);
  if (ordersError) throw new Error(ordersError.message);

  const rows: {
    order_id: string;
    custom_field_id: string;
    value: unknown;
  }[] = [];

  for (const order of (orders ?? []) as { id: string }[]) {
    if (fieldIds.nameId) {
      rows.push({
        order_id: order.id,
        custom_field_id: fieldIds.nameId,
        value: name,
      });
    }
    if (fieldIds.contactId) {
      rows.push({
        order_id: order.id,
        custom_field_id: fieldIds.contactId,
        value: contact,
      });
    }
  }

  if (rows.length === 0) return;

  const { error } = await client
    .from("custom_field_values")
    .upsert(rows, { onConflict: "order_id,custom_field_id" });
  if (error) throw new Error(error.message);
}

/** Admin edit — full replace of name/email/phone/company on customers + linked orders. */
export async function updateCustomerByAdmin(
  client: Client,
  tenantId: string,
  customerId: string,
  input: AdminCustomerUpdateInput
): Promise<Customer> {
  const validationError = validateAdminCustomerUpdate(input);
  if (validationError) throw new Error(validationError);

  const existing = await loadCustomerById(client, customerId);
  if (!existing || existing.tenant_id !== tenantId) {
    throw new Error("Customer not found");
  }

  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const name = input.name.trim();
  const company = input.company?.trim() || null;
  const preferred_channel = normalizePreferredChannel(input.preferred_channel);

  if (email) {
    const emailMatch = await findCustomerByEmail(client, tenantId, email);
    if (emailMatch && emailMatch.id !== customerId) {
      throw new Error("Another customer already uses this email");
    }
  }

  if (phone) {
    const phoneMatch = await findCustomerByPhone(client, tenantId, phone);
    if (phoneMatch && phoneMatch.id !== customerId) {
      throw new Error("Another customer already uses this phone number");
    }
  }

  const { data: updated, error } = await client
    .from("customers")
    .update({ name, email, phone, company, preferred_channel })
    .eq("id", customerId)
    .eq("tenant_id", tenantId)
    .select(CUSTOMER_SELECT)
    .single();

  if (error || !updated) {
    if (isUniqueViolation(error)) {
      throw new Error("Email or phone is already used by another customer");
    }
    throw new Error(error?.message ?? "Failed to update customer");
  }

  await syncOrdersCustomerFields(client, tenantId, customerId, name, email, phone);

  return updated as Customer;
}
