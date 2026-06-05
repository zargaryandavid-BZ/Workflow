import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CustomersManager } from "./customers-manager";
import type {
  BoardColumn,
  Customer,
  CustomerOrderSummary,
  CustomerWithStats,
  Order,
} from "@/lib/types";

export default async function CustomersPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;

  const supabase = await createClient();
  const [{ data: customers }, { data: orders }, { data: columns }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("*")
        .eq("tenant_id", ctx.tenant.id)
        .order("name", { ascending: true }),
      supabase
        .from("orders")
        .select("id, title, customer_id, created_at, column_id")
        .eq("tenant_id", ctx.tenant.id)
        .not("customer_id", "is", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("board_columns")
        .select("id, name")
        .eq("tenant_id", ctx.tenant.id),
    ]);

  const columnNameById = new Map(
    ((columns ?? []) as Pick<BoardColumn, "id" | "name">[]).map((c) => [
      c.id,
      c.name,
    ])
  );

  const statsByCustomer = new Map<
    string,
    { order_count: number; last_order_at: string | null }
  >();
  const ordersByCustomer: Record<string, CustomerOrderSummary[]> = {};

  for (const order of (orders ?? []) as Pick<
    Order,
    "id" | "title" | "customer_id" | "created_at" | "column_id"
  >[]) {
    const customerId = order.customer_id;
    if (!customerId) continue;

    const stats = statsByCustomer.get(customerId) ?? {
      order_count: 0,
      last_order_at: null,
    };
    stats.order_count += 1;
    if (!stats.last_order_at) stats.last_order_at = order.created_at;
    statsByCustomer.set(customerId, stats);

    const list = ordersByCustomer[customerId] ?? [];
    list.push({
      id: order.id,
      title: order.title,
      created_at: order.created_at,
      column_id: order.column_id,
      column_name: columnNameById.get(order.column_id) ?? null,
    });
    ordersByCustomer[customerId] = list;
  }

  const customersWithStats: CustomerWithStats[] = (
    (customers ?? []) as Customer[]
  ).map((c) => {
    const stats = statsByCustomer.get(c.id);
    return {
      ...c,
      order_count: stats?.order_count ?? 0,
      last_order_at: stats?.last_order_at ?? null,
    };
  });

  return (
    <div className="board-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <h1 className="text-lg font-semibold text-slate-800">Customers</h1>
        <p className="mb-5 text-sm text-slate-500">
          Auto-populated from orders.{" "}
          {customersWithStats.length === 1
            ? "1 customer"
            : `${customersWithStats.length} customers`}
          . Customers are added automatically when orders are created.
        </p>
        <CustomersManager
          customers={customersWithStats}
          ordersByCustomer={ordersByCustomer}
        />
      </div>
    </div>
  );
}
