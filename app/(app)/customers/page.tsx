import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CustomersManager } from "./customers-manager";
import type {
  BoardColumn,
  Customer,
  CustomerOrderSummary,
  CustomerWithStats,
  CustomField,
  Order,
} from "@/lib/types";

export default async function CustomersPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const [
    { data: customers },
    { data: orders },
    { data: columns },
    { data: customFields },
    { data: memberRows },
  ] = await Promise.all([
    supabase
      .from("customers")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true }),
    supabase
      .from("orders")
      .select("id, title, customer_id, created_at, column_id")
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .not("customer_id", "is", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("board_columns")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    supabase
      .from("custom_fields")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    supabase
      .from("memberships")
      .select("user_id, role")
      .eq("tenant_id", tenantId),
  ]);

  const columnNameById = new Map(
    ((columns ?? []) as Pick<BoardColumn, "id" | "name">[]).map((c) => [
      c.id,
      c.name,
    ])
  );

  const members = (memberRows ?? []) as { user_id: string; role: string }[];
  const memberIds = [...new Set(members.map((m) => m.user_id))];
  const designerIds = members
    .filter((m) => m.role === "designer")
    .map((m) => m.user_id);

  let designers: { id: string; name: string }[] = [];
  let owners: { id: string; name: string }[] = [];
  if (memberIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", memberIds);
    const nameById = new Map(
      ((profiles ?? []) as { id: string; full_name: string | null }[]).map(
        (p) => [p.id, p.full_name?.trim() || "Staff member"]
      )
    );
    owners = memberIds
      .map((id) => ({ id, name: nameById.get(id) ?? "Staff member" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    designers = designerIds.map((id) => ({
      id,
      name: nameById.get(id) ?? "Unnamed designer",
    }));
  }

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
          .
          {ctx.role === "admin"
            ? " Admins can edit customer details from the customer panel."
            : " Customers are added automatically when orders are created."}
        </p>
        <CustomersManager
          customers={customersWithStats}
          ordersByCustomer={ordersByCustomer}
          customFields={(customFields ?? []) as CustomField[]}
          owners={owners}
          columns={(columns ?? []) as BoardColumn[]}
          designers={designers}
          role={ctx.role}
        />
      </div>
    </div>
  );
}
