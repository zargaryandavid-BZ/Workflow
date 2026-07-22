import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveDateRange,
  computeAnalyticsStats,
  type AnalyticsFilter,
} from "@/lib/analytics";

export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const filter = (searchParams.get("filter") ?? "today") as AnalyticsFilter;
  const customFrom = searchParams.get("customFrom") ?? undefined;
  const customTo = searchParams.get("customTo") ?? undefined;
  const columnIdsParam = searchParams.get("columnIds");
  const designerColumnIds = columnIdsParam
    ? columnIdsParam
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : undefined;

  const { dateFrom, dateTo, prevFrom, prevTo } = resolveDateRange(
    filter,
    customFrom,
    customTo
  );

  const supabase = createAdminClient();

  const [
    { data: columnsRaw, error: columnsError },
    { data: ordersRaw, error: ordersError },
    { data: activeOrdersRaw, error: activeError },
    { data: activityRaw, error: activityError },
    { data: notificationsRaw, error: notificationsError },
    { data: membershipsRaw, error: membershipsError },
  ] = await Promise.all([
    supabase
      .from("board_columns")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true }),
    supabase
      .from("orders")
      .select("id, column_id, due_date, created_at, updated_at, specs")
      .eq("tenant_id", ctx.tenant.id)
      .is("removed_at", null),
    supabase
      .from("orders")
      .select("id, column_id, due_date, specs")
      .eq("tenant_id", ctx.tenant.id)
      .is("removed_at", null),
    supabase
      .from("activity_log")
      .select("id, order_id, action, metadata, created_at")
      .eq("tenant_id", ctx.tenant.id)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("job_notifications")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "responded")
      .not("responded_at", "is", null),
    supabase
      .from("memberships")
      .select("user_id, role")
      .eq("tenant_id", ctx.tenant.id),
  ]);

  if (
    columnsError ||
    ordersError ||
    activeError ||
    activityError ||
    notificationsError ||
    membershipsError
  ) {
    const msg =
      columnsError?.message ??
      ordersError?.message ??
      activeError?.message ??
      activityError?.message ??
      notificationsError?.message ??
      membershipsError?.message ??
      "Failed to load analytics";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Fetch profiles for all tenant members
  const memberUserIds = (membershipsRaw ?? []).map(
    (m: { user_id: string }) => m.user_id
  );
  const { data: profilesData } = memberUserIds.length > 0
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", memberUserIds)
    : { data: [] };

  const profileNameById = new Map(
    ((profilesData ?? []) as { id: string; full_name: string | null }[]).map(
      (p) => [p.id, p.full_name?.trim() || "Unnamed"]
    )
  );
  const designersRaw = (membershipsRaw ?? [])
    .filter((m: { role: string }) => m.role === "designer")
    .map((m: { user_id: string }) => ({
      id: m.user_id,
      name: profileNameById.get(m.user_id) ?? "Unnamed",
    }));

  const stats = computeAnalyticsStats({
    filter,
    dateFrom,
    dateTo,
    prevFrom,
    prevTo,
    columnsRaw: columnsRaw ?? [],
    ordersRaw: ordersRaw ?? [],
    activeOrdersRaw: activeOrdersRaw ?? [],
    activityRaw: activityRaw ?? [],
    notificationsRaw: notificationsRaw ?? [],
    profilesRaw: profilesData ?? [],
    designersRaw,
    designerColumnIds,
  });

  return NextResponse.json(stats);
}
