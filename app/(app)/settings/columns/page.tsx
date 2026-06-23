import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BOARD_ROLES, ROLE_ABBR, ROLE_LABELS } from "@/lib/constants";
import { ColumnsManager } from "./columns-manager";
import type { BoardColumn } from "@/lib/types";

export type ColumnMember = {
  user_id: string;
  name: string;
  role: string;
};

export default async function ColumnsSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  const [columnsRes, ordersRes, membershipsRes] = await Promise.all([
    supabase
      .from("board_columns")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true }),
    supabase.from("orders").select("column_id").eq("tenant_id", ctx.tenant.id),
    supabase
      .from("memberships")
      .select("user_id, role")
      .eq("tenant_id", ctx.tenant.id),
  ]);

  // Resolve names from profiles for the member list.
  const memberRows = (membershipsRes.data ?? []) as {
    user_id: string;
    role: string;
  }[];
  const memberIds = memberRows.map((m) => m.user_id);
  let profileNames = new Map<string, string>();
  if (memberIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", memberIds);
    profileNames = new Map(
      ((profiles ?? []) as { id: string; full_name: string | null }[]).map(
        (p) => [p.id, p.full_name?.trim() || "Team member"]
      )
    );
  }
  const members: ColumnMember[] = memberRows.map((m) => ({
    user_id: m.user_id,
    name: profileNames.get(m.user_id) ?? "Team member",
    role: m.role,
  }));

  const counts: Record<string, number> = {};
  for (const o of (ordersRes.data ?? []) as { column_id: string }[]) {
    counts[o.column_id] = (counts[o.column_id] ?? 0) + 1;
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">
        Production Columns
      </h1>
      <p className="text-sm text-slate-500">
        Define your pipeline stages. Reorder them, set a color and picture, edit
        names, and remove stages you no longer need.
      </p>
      <p className="mb-5 text-xs text-slate-400">
        * ↓ = drop into stage · ↑ = drop out of stage · Role abbreviations:{" "}
        {BOARD_ROLES.map((role, i) => (
          <span key={role}>
            {i > 0 ? " · " : null}
            {ROLE_ABBR[role]} = {ROLE_LABELS[role]}
          </span>
        ))}
      </p>
      <ColumnsManager
        initialColumns={(columnsRes.data ?? []) as BoardColumn[]}
        orderCounts={counts}
        members={members}
      />
    </div>
  );
}
