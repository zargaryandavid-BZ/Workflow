import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadTeamMembers } from "@/lib/team-members";
import { normalizeDesignerAssignment } from "@/lib/designer-assignment-settings";
import { DesignerAssignmentManager } from "./designer-assignment-manager";

export default async function DesignersSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenants")
    .select(
      "designer_autoassign_enabled, designer_pool, designer_stale_hours, designer_working_days"
    )
    .eq("id", ctx.tenant.id)
    .maybeSingle();

  const migrationRequired = Boolean(
    error && /designer_(autoassign_enabled|pool|stale_hours|working_days)|column .* does not exist/i.test(error.message)
  );

  const initial = normalizeDesignerAssignment(
    migrationRequired ? null : (data as Record<string, unknown> | null)
  );

  const { members } = await loadTeamMembers(ctx.tenant.id);
  const designers = (members ?? [])
    .filter((m) => m.role === "designer")
    .map((m) => ({
      id: m.user_id,
      name:
        m.profile?.full_name?.trim() ||
        m.email?.split("@")[0]?.trim() ||
        "Designer",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">Designers</h1>
      <p className="mb-6 text-sm text-slate-500">
        Automatically hand new orders to the least-busy designer, and move a job
        to another designer when it has been sitting too long.
      </p>

      <DesignerAssignmentManager
        initial={initial}
        designers={designers}
        migrationRequired={migrationRequired}
      />
    </div>
  );
}
