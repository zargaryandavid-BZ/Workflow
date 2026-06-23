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
    { data: profilesRaw, error: profilesError },
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
      .select("user_id")
      .eq("tenant_id", ctx.tenant.id),
    supabase
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", ctx.tenant.id),
  ]);

  if (
    columnsError ||
    ordersError ||
    activeError ||
    activityError ||
    notificationsError ||
    profilesError ||
    membershipsError
  ) {
    const msg =
      columnsError?.message ??
      ordersError?.message ??
      activeError?.message ??
      activityError?.message ??
      notificationsError?.message ??
      profilesError?.message ??
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
  });

  return NextResponse.json(stats);
}
