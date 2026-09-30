import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { canControlPrepressTimer } from "@/lib/permissions";
import { isPrepressColumnName } from "@/lib/prepress-queue";

type OrderRow = {
  id: string;
  title: string;
  due_date: string | null;
  column_id: string;
  specs: Record<string, unknown> | null;
  customer: { name: string } | { name: string }[] | null;
};

function customerName(
  customer: OrderRow["customer"]
): string | null {
  if (!customer) return null;
  const c = Array.isArray(customer) ? customer[0] : customer;
  return c?.name?.trim() || null;
}

/**
 * Orders the current user can start a timer against.
 * Prefer jobs assigned to them (specs.designer_id); when `q` is set, also
 * search all active tenant orders by title.
 */
export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const prepress = searchParams.get("timer_kind") === "prepress";
  if (prepress && !canControlPrepressTimer(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  let prepressColumnIds: string[] = [];
  if (prepress) {
    const { data: columns } = await supabase
      .from("board_columns")
      .select("id, name")
      .eq("tenant_id", ctx.tenant.id);
    prepressColumnIds = ((columns ?? []) as { id: string; name: string }[])
      .filter((column) => isPrepressColumnName(column.name))
      .map((column) => column.id);
  }
  const { data, error } = await supabase
    .from("orders")
    .select("id, title, due_date, column_id, specs, customer:customers(name)")
    .eq("tenant_id", ctx.tenant.id)
    .is("removed_at", null)
    .order("due_date", { ascending: true })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = ((data ?? []) as unknown as OrderRow[]).filter(
    (row) => !prepress || prepressColumnIds.includes(row.column_id)
  );

  const assigned: OrderRow[] = [];
  const others: OrderRow[] = [];

  for (const row of rows) {
    const designerId =
      typeof row.specs?.designer_id === "string"
        ? row.specs.designer_id.trim()
        : "";
    if (designerId === ctx.userId) {
      assigned.push(row);
    } else {
      others.push(row);
    }
  }

  let pool = prepress ? rows : assigned;
  if (q) {
    const match = (row: OrderRow) => {
      const title = row.title.toLowerCase();
      const cust = (customerName(row.customer) ?? "").toLowerCase();
      return title.includes(q) || cust.includes(q);
    };
    const assignedMatches = assigned.filter(match);
    const otherMatches = others.filter(match);
    pool = [...assignedMatches, ...otherMatches];
  }

  const orders = pool.slice(0, 40).map((row) => ({
    id: row.id,
    title: row.title,
    due_date: row.due_date,
    customer_name: customerName(row.customer),
    assigned: typeof row.specs?.designer_id === "string"
      ? row.specs.designer_id.trim() === ctx.userId
      : false,
  }));

  return NextResponse.json({ orders });
}
