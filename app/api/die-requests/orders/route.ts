import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import {
  compactOrderNumberToken,
  formatShortOrderNumber,
  isOrderArchived,
  isOrderNumberQuery,
  orderMatchesNumberSearch,
} from "@/lib/board-order-filters";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

function escapeIlike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[%_,]/g, "\\$&");
}

type OrderRow = {
  id: string;
  title: string;
  due_date: string | null;
  specs: Record<string, unknown> | null;
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
  if (compact && compact !== q.toLowerCase()) terms.add(compact);

  const orParts: string[] = [];
  for (const term of terms) {
    const termPattern = `%${escapeIlike(term)}%`;
    orParts.push(`title.ilike.${termPattern}`);
    orParts.push(`specs->>webhook_order_number.ilike.${termPattern}`);
    orParts.push(`specs->>webhook_item_title.ilike.${termPattern}`);
  }

  const select =
    "id, title, due_date, specs, customer:customers(name, email)";
  const base = () =>
    supabase
      .from("orders")
      .select(select)
      .eq("tenant_id", ctx.tenant.id)
      .is("removed_at", null)
      .order("created_at", { ascending: false })
      .limit(120);

  let { data, error } = await base().or(orParts.join(","));
  if (error) {
    const retry = await base().or(
      [...terms]
        .map((term) => `title.ilike.%${escapeIlike(term)}%`)
        .join(",")
    );
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const qLower = q.toLowerCase();
  const numberQuery = isOrderNumberQuery(q);

  const orders = ((data ?? []) as OrderRow[])
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
    .slice(0, 15)
    .map((row) => {
      const customer = Array.isArray(row.customer)
        ? row.customer[0]
        : row.customer;
      return {
        id: row.id,
        title: row.title,
        orderNumber: formatShortOrderNumber(row.title),
        dueDate: row.due_date,
        customerName: customer?.name?.trim() || null,
        email: customer?.email?.trim() || null,
      };
    });

  return NextResponse.json({ orders });
}
