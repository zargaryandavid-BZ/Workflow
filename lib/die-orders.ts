import { createClient } from "@/lib/supabase/server";
import { findOrderFormField } from "@/lib/order-form";
import type { CustomField } from "@/lib/types";

export type DieOrderRow = {
  orderId: string;
  title: string;
  die: string;
  customerName: string | null;
  columnName: string | null;
  dueDate: string | null;
};

function dieText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export async function loadDieOrderRows(
  tenantId: string
): Promise<DieOrderRow[]> {
  const supabase = await createClient();

  const { data: fields } = await supabase
    .from("custom_fields")
    .select("*")
    .eq("tenant_id", tenantId);

  const dieField = findOrderFormField(
    (fields ?? []) as CustomField[],
    "Die"
  );
  if (!dieField) return [];

  const { data: values } = await supabase
    .from("custom_field_values")
    .select("order_id, value")
    .eq("field_id", dieField.id);

  const dieByOrder = new Map<string, string>();
  for (const row of values ?? []) {
    const text = dieText(row.value);
    if (text && text !== "null" && text !== "[]" && text !== "{}") {
      dieByOrder.set(row.order_id as string, text);
    }
  }
  if (dieByOrder.size === 0) return [];

  const orderIds = [...dieByOrder.keys()];
  const [{ data: orders }, { data: columns }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, title, due_date, column_id, customer:customers(name)")
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .in("id", orderIds),
    supabase
      .from("board_columns")
      .select("id, name")
      .eq("tenant_id", tenantId),
  ]);

  const columnNameById = new Map(
    ((columns ?? []) as { id: string; name: string }[]).map((c) => [
      c.id,
      c.name,
    ])
  );

  const rows: DieOrderRow[] = ((orders ?? []) as {
    id: string;
    title: string;
    due_date: string | null;
    column_id: string;
    customer: { name: string | null } | { name: string | null }[] | null;
  }[]).map((order) => {
    const customer = Array.isArray(order.customer)
      ? order.customer[0]
      : order.customer;
    return {
      orderId: order.id,
      title: order.title,
      die: dieByOrder.get(order.id) ?? "",
      customerName: customer?.name?.trim() || null,
      columnName: columnNameById.get(order.column_id) ?? null,
      dueDate: order.due_date,
    };
  });

  rows.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return a.title.localeCompare(b.title);
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  return rows;
}
