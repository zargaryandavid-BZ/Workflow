import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { columnMoveColumnIds, enrichActivityLog, isColumnMoveActivity, mergeActivityById } from "@/lib/activity";
import { ACTIVITY_LOG_LIMIT, ACTIVITY_MOVE_LOG_LIMIT } from "@/lib/constants";
import { loadOrderWithRelations } from "@/lib/orders/load-with-relations";
import type {
  ActivityLog,
  Asset,
  Order,
  OrderNote,
} from "@/lib/types";

/**
 * Secondary card-detail payload: activity, notifications, approvals, notes.
 * Loaded after the fast core GET so the modal can paint first.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const [
    order,
    activityResult,
    moveActivityResult,
    approvalsResult,
    notificationResult,
    notesResult,
  ] = await Promise.all([
    loadOrderWithRelations(supabase, id, tenantId),
    supabase
      .from("activity_log")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_LOG_LIMIT),
    supabase
      .from("activity_log")
      .select("*")
      .eq("order_id", id)
      .in("action", [
        "moved",
        "idle_auto_moved",
        "approved",
        "rejected",
        "customer_replied",
      ])
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_MOVE_LOG_LIMIT),
    supabase
      .from("approvals")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("job_notifications")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("order_notes")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const approvals = approvalsResult.data;
  const notificationRows = notificationResult.data;
  const notesRows = notesResult.data;

  const allNotifications = notificationRows ?? [];
  const missingInfoList = allNotifications.filter(
    (n) => n.type === "missing_info"
  );
  const approvalList = allNotifications.filter(
    (n) => n.type === "customer_approval"
  );
  const notesList = (notesRows ?? []) as {
    id: string;
    tenant_id: string;
    order_id: string;
    created_by: string | null;
    text: string;
    created_at: string;
  }[];
  const notificationIds = missingInfoList.map((n) => n.id as string);

  const activityRows = mergeActivityById(
    (activityResult.data ?? []) as ActivityLog[],
    (moveActivityResult.data ?? []) as ActivityLog[]
  );
  const profileIds = new Set<string>();
  const columnIds = new Set<string>();
  for (const n of [...allNotifications, ...notesList]) {
    if (n.created_by) profileIds.add(n.created_by as string);
  }
  if (order.created_by) profileIds.add(order.created_by);
  for (const log of activityRows) {
    if (log.actor) profileIds.add(log.actor);
    if (isColumnMoveActivity(log)) {
      for (const colId of columnMoveColumnIds(log)) columnIds.add(colId);
    }
  }

  const [{ data: profiles }, { data: responseAssets }, columnsResult] =
    await Promise.all([
      profileIds.size > 0
        ? supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", [...profileIds])
        : Promise.resolve({
            data: [] as { id: string; full_name: string | null }[],
          }),
      notificationIds.length > 0
        ? supabase
            .from("assets")
            .select("*")
            .in("notification_id", notificationIds)
        : Promise.resolve({ data: [] as Asset[] }),
      columnIds.size > 0
        ? supabase
            .from("board_columns")
            .select("id, name")
            .in("id", [...columnIds])
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);

  const creatorNameById = new Map(
    ((profiles ?? []) as { id: string; full_name: string | null }[]).map(
      (p) => [p.id, p.full_name?.trim() || "Staff member"]
    )
  );
  const columnNameById = new Map(
    ((columnsResult.data ?? []) as { id: string; name: string }[]).map((c) => [
      c.id,
      c.name,
    ])
  );
  const notificationActorById = new Map<string, string>();
  for (const notification of allNotifications) {
    if (notification.id && notification.created_by) {
      notificationActorById.set(
        notification.id as string,
        notification.created_by as string
      );
    }
  }

  const assetsByNotification = new Map<string, Asset[]>();
  for (const asset of (responseAssets ?? []) as Asset[]) {
    const nid = asset.notification_id as string | null;
    if (!nid) continue;
    const list = assetsByNotification.get(nid) ?? [];
    list.push(asset);
    assetsByNotification.set(nid, list);
  }

  const missingInfo = missingInfoList.map((n) => ({
    ...n,
    creator_name: n.created_by
      ? (creatorNameById.get(n.created_by as string) ?? null)
      : null,
    response_assets: assetsByNotification.get(n.id as string) ?? [],
  }));

  const approvalNotes = approvalList.map((n) => ({
    ...n,
    creator_name: n.created_by
      ? (creatorNameById.get(n.created_by as string) ?? null)
      : null,
  }));

  const notifications = allNotifications.map((n) => ({
    ...n,
    creator_name: n.created_by
      ? (creatorNameById.get(n.created_by as string) ?? null)
      : null,
  }));

  const enrichedActivity = await enrichActivityLog(
    supabase,
    activityRows,
    order as Order,
    {
      nameById: creatorNameById,
      columnNameById,
      notificationActorById,
    }
  );

  const notes: OrderNote[] = notesList.map((n) => ({
    id: n.id,
    tenant_id: n.tenant_id,
    order_id: n.order_id,
    created_by: n.created_by,
    creator_name: n.created_by
      ? (creatorNameById.get(n.created_by) ?? "Staff member")
      : null,
    text: n.text,
    created_at: n.created_at,
  }));

  return NextResponse.json({
    activity: enrichedActivity,
    approvals: approvals ?? [],
    missingInfo,
    approvalNotes,
    notifications,
    notes,
    timelinePending: false,
    tabHints: {
      hasMissingInfo: missingInfo.length > 0,
      hasApproval: approvalNotes.length > 0,
    },
  });
}
