import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadTeamMembers } from "@/lib/team-members";
import {
  getDesignerAssignmentSettings,
  normalizeDesignerAssignment,
} from "@/lib/designer-assignment-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → current settings + the designers available for the pool. */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin")
    return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const supabase = await createClient();
  const settings = await getDesignerAssignmentSettings(supabase, ctx.tenant.id);
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

  return NextResponse.json({ settings, designers });
}

/** PATCH → save settings (admin only). */
export async function PATCH(req: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin")
    return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    enabled?: boolean;
    pool?: string[];
    staleHours?: number;
    workingDays?: number[];
  };

  // Only designers may be in the pool.
  const { members } = await loadTeamMembers(ctx.tenant.id);
  const designerIds = new Set(
    (members ?? []).filter((m) => m.role === "designer").map((m) => m.user_id)
  );
  const pool = Array.isArray(body.pool)
    ? [...new Set(body.pool.filter((id) => typeof id === "string" && designerIds.has(id)))]
    : [];

  const staleHours =
    body.staleHours === undefined
      ? 0
      : Math.max(0, Math.min(2000, Math.round(Number(body.staleHours) || 0)));

  const workingDays = Array.isArray(body.workingDays)
    ? [
        ...new Set(
          body.workingDays
            .map((d) => Math.round(Number(d)))
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        ),
      ].sort((a, b) => a - b)
    : [1, 2, 3, 4, 5];

  const enabled = body.enabled === true;
  if (enabled && pool.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one designer before turning auto-assign on." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update({
      designer_autoassign_enabled: enabled,
      designer_pool: pool,
      designer_stale_hours: staleHours,
      designer_working_days: workingDays.length ? workingDays : [1, 2, 3, 4, 5],
    })
    .eq("id", ctx.tenant.id);

  if (error) {
    const migrationRequired = /designer_(autoassign_enabled|pool|stale_hours|working_days)|column .* does not exist/i.test(
      error.message
    );
    return NextResponse.json(
      {
        error: migrationRequired
          ? "Designer settings columns are missing — run the latest database migration."
          : error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    settings: normalizeDesignerAssignment({
      designer_autoassign_enabled: enabled,
      designer_pool: pool,
      designer_stale_hours: staleHours,
      designer_working_days: workingDays,
    }),
  });
}
