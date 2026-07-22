import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";

type OrderRow = {
  id: string;
  title: string;
  due_date: string | null;
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

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, title, due_date, specs, customer:customers(name)")
    .eq("tenant_id", ctx.tenant.id)
    .is("removed_at", null)
    .order("due_date", { ascending: true })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as OrderRow[];

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

  let pool = assigned;
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
