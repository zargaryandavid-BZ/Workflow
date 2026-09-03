import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import {
  compactOrderNumberToken,
  dieOrderNumberMatchRank,
  formatShortOrderNumber,
  isOrderArchived,
  isOrderNumberQuery,
  orderMatchesNumberSearch,
} from "@/lib/board-order-filters";
import { dieOrderAutofill } from "@/lib/die-order-autofill";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import type { CustomField } from "@/lib/types";

function escapeIlike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[%_,]/g, "\\$&");
}

type OrderRow = {
  id: string;
  title: string;
  due_date: string | null;
  specs: Record<string, unknown> | null;
  crm_snapshot: unknown;
  user_overrides: unknown;
  customer:
    | { name: string | null; email: string | null }
    | { name: string | null; email: string | null }[]
    | null;
};

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().replace(/^#/, "");
  if (!q) {
    return NextResponse.json({ orders: [] });
  }

  const supabase = await createClient();
  const terms = new Set([q]);
  const compact = compactOrderNumberToken(q);
  if (compact) terms.add(compact);

  const orParts: string[] = [];
  for (const term of terms) {
    const escaped = escapeIlike(term);
    orParts.push(`title.ilike.${escaped}%`);
    orParts.push(`title.ilike.%${escaped}%`);
    orParts.push(`specs->>webhook_order_number.ilike.%${escaped}%`);
    orParts.push(`specs->>webhook_item_title.ilike.%${escaped}%`);
  }

  const selectWithCrm =
    "id, title, due_date, specs, crm_snapshot, user_overrides, customer:customers(name, email)";
  const selectPlain =
    "id, title, due_date, specs, customer:customers(name, email)";
  const base = (select: string) =>
    supabase
      .from("orders")
      .select(select)
      .eq("tenant_id", ctx.tenant.id)
      .is("removed_at", null)
      .order("created_at", { ascending: false })
      .limit(500);

  let { data, error } = await base(selectWithCrm).or(orParts.join(","));
  if (error && /crm_snapshot|user_overrides/i.test(error.message)) {
    const retry = await base(selectPlain).or(orParts.join(","));
    data = retry.data as typeof data;
    error = retry.error;
  }
  if (error) {
    const retry = await base(selectPlain).or(
      [...terms]
        .map((term) => `title.ilike.%${escapeIlike(term)}%`)
        .join(",")
    );
    data = retry.data as typeof data;
    error = retry.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const qLower = q.toLowerCase();
  const numberQuery = isOrderNumberQuery(q);

  const matched = ((data ?? []) as unknown as OrderRow[])
    .filter((row) => !isOrderArchived(row))
    .filter((row) => {
      if (numberQuery) return orderMatchesNumberSearch(row, q);
      const customer = Array.isArray(row.customer)
        ? row.customer[0]
        : row.customer;
      const blob = [
        row.title,
        formatShortOrderNumber(row.title),
        customer?.name ?? "",
        customer?.email ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return (
        orderMatchesNumberSearch(row, q) ||
        blob.includes(qLower) ||
        (compact && blob.includes(compact))
      );
    })
    .sort(
      (a, b) =>
        dieOrderNumberMatchRank(a, q) - dieOrderNumberMatchRank(b, q)
    )
    .slice(0, 15);

  const fieldValuesByOrder: Record<string, Record<string, unknown>> = {};
  let customFields: CustomField[] = [];
  if (matched.length > 0) {
    const { data: fields } = await supabase
      .from("custom_fields")
      .select("id, name, field_type")
      .eq("tenant_id", ctx.tenant.id);
    customFields = (fields ?? []) as CustomField[];
    const fieldIds = customFields.map((f) => f.id);
    if (fieldIds.length > 0) {
      const { data: values } = await supabase
        .from("custom_field_values")
        .select("order_id, custom_field_id, value")
        .in(
          "order_id",
          matched.map((row) => row.id)
        )
        .in("custom_field_id", fieldIds);
      for (const row of values ?? []) {
        const orderId = String(row.order_id);
        const fieldId = String(row.custom_field_id);
        if (!fieldValuesByOrder[orderId]) fieldValuesByOrder[orderId] = {};
        fieldValuesByOrder[orderId]![fieldId] = row.value;
      }
    }
  }

  const orders = matched.map((row) => {
    const customer = Array.isArray(row.customer)
      ? row.customer[0]
      : row.customer;
    const fill = dieOrderAutofill({
      customFields,
      fieldValues: fieldValuesByOrder[row.id] ?? {},
      crmSnapshot: row.crm_snapshot,
      userOverrides: row.user_overrides,
    });
    return {
      id: row.id,
      title: row.title,
      orderNumber: formatShortOrderNumber(row.title),
      dueDate: row.due_date,
      customerName: customer?.name?.trim() || null,
      email: customer?.email?.trim() || null,
      productName: fill.productName || null,
      width: fill.width || null,
      height: fill.height || null,
      depth: fill.depth || null,
    };
  });

  return NextResponse.json({ orders });
}
