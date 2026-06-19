import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRemovedOrdersWithRelations } from "@/lib/orders/load-with-relations";
import { RemovedOrdersManager } from "./removed-orders-manager";
import type { BoardColumn, Category, CustomField } from "@/lib/types";

export default async function RemovedOrdersSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const [orders, columnsRes, fieldsRes, categoriesRes, designerMemberRes] =
    await Promise.all([
      loadRemovedOrdersWithRelations(supabase, tenantId),
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
        .from("categories")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("position", { ascending: true }),
      supabase
        .from("memberships")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("role", "designer"),
    ]);

  const designerIds = (
    (designerMemberRes.data ?? []) as { user_id: string }[]
  ).map((m) => m.user_id);
  let designers: { id: string; name: string }[] = [];
  if (designerIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", designerIds);
    const nameById = new Map(
      ((profiles ?? []) as { id: string; full_name: string | null }[]).map(
        (p) => [p.id, p.full_name]
      )
    );
    designers = designerIds.map((id) => ({
      id,
      name: nameById.get(id) ?? "Unnamed designer",
    }));
  }

  const removedByIds = [
    ...new Set(
      orders
        .map((o) => o.removed_by)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  let removedByNameById: Record<string, string> = {};
  if (removedByIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", removedByIds);
    removedByNameById = Object.fromEntries(
      ((profiles ?? []) as { id: string; full_name: string | null }[]).map(
        (p) => [p.id, p.full_name?.trim() || "Admin"]
      )
    );
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">Removed Orders</h1>
      <p className="mb-5 text-sm text-slate-500">
        Orders removed from the board. Only admins can see this list.
      </p>
      <RemovedOrdersManager
        orders={orders}
        columns={(columnsRes.data ?? []) as BoardColumn[]}
        categories={(categoriesRes.data ?? []) as Category[]}
        customFields={(fieldsRes.data ?? []) as CustomField[]}
        designers={designers}
        role={ctx.role}
        removedByNameById={removedByNameById}
      />
    </div>
  );
}
