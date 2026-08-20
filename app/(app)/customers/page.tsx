import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CustomersManager } from "./customers-manager";
import { loadAccountManagerOwners } from "@/lib/order-owners";
import type { BoardColumn, CustomField } from "@/lib/types";

export default async function CustomersPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const [
    { data: columns },
    { data: customFields },
    { data: memberRows },
  ] = await Promise.all([
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

  const members = (memberRows ?? []) as { user_id: string; role: string }[];
  const designerIds = members
    .filter((m) => m.role === "designer")
    .map((m) => m.user_id);

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

  const owners = await loadAccountManagerOwners(supabase, tenantId);

  return (
    <div className="board-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <h1 className="text-lg font-semibold text-slate-800">Customers</h1>
        <p className="mb-5 text-sm text-slate-500">
          Add one here, or they appear automatically from orders.
        </p>
        <CustomersManager
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
