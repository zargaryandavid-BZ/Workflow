import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  notificationToCardBadge,
  type CardNotificationBadge,
} from "@/lib/card-badges";
import {
  thumbnailUrlsByOrder,
  type OrderAssetPreviewRow,
} from "@/lib/board-card-previews";
import type {
  CustomerResponse,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  OrderWithRelations,
} from "@/lib/types";

export const PAGE_SIZE = 25;

export interface ColumnOrdersResponse {
  orders: OrderWithRelations[];
  fieldValuesByOrder: Record<string, Record<string, unknown>>;
  thumbnailByOrder: Record<string, string>;
  notificationBadgeByOrder: Record<string, CardNotificationBadge>;
  ownerNameByOrder: Record<string, string>;
  designerNameByOrder: Record<string, string>;
  hasMore: boolean;
  total: number;
  page: number;
}

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const columnId = searchParams.get("columnId");
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10));

  if (!columnId) {
    return NextResponse.json({ error: "columnId required" }, { status: 400 });
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Fetch orders — tenant_id filter already scopes to this tenant, so a
  // separate column-ownership check is redundant and just adds a round-trip.
  const { data: rawOrders, error: ordersError, count } = await supabase
    .from("orders")
    .select("*, customer:customers(*), tag:tags(id, name, color)", {
      count: "exact",
    })
    .eq("tenant_id", tenantId)
    .eq("column_id", columnId)
    .is("removed_at", null)
    .order("position", { ascending: true })
    .range(from, to);

  if (ordersError) {
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 }
    );
  }

  const orders = (rawOrders ?? []) as OrderWithRelations[];
  const total = count ?? 0;
  const hasMore = total > (page + 1) * PAGE_SIZE;

  const empty: ColumnOrdersResponse = {
    orders: [],
    fieldValuesByOrder: {},
    thumbnailByOrder: {},
    notificationBadgeByOrder: {},
    ownerNameByOrder: {},
    designerNameByOrder: {},
    hasMore: false,
    total,
    page,
  };

  if (orders.length === 0) {
    return NextResponse.json(empty);
  }

  const orderIds = orders.map((o) => o.id);

  // Pre-compute profile ID sets synchronously so the queries can run in the
  // same Promise.all as the other enrichments.
  const creatorIds = [
    ...new Set(orders.map((o) => o.created_by).filter((id): id is string => Boolean(id))),
  ];
  const designerIdsNeeded: string[] = [];
  const designerNameByOrderPre: Record<string, string> = {};
  for (const o of orders) {
    const specs = o.specs as Record<string, unknown> | null;
    const storedName = typeof specs?.designer_name === "string" ? specs.designer_name.trim() : "";
    if (storedName) {
      designerNameByOrderPre[o.id] = storedName;
    } else {
      const id = typeof specs?.designer_id === "string" ? specs.designer_id.trim() : "";
      if (id) designerIdsNeeded.push(id);
    }
  }
  const uniqueDesignerIds = [...new Set(designerIdsNeeded)];

  // All enrichments — including profile lookups and thumbnail signing — run in
  // parallel so there is only one network wait instead of multiple sequential ones.
  const [valuesRes, thumbnailByOrder, notifRes, ownerProfiles, designerProfiles] =
    await Promise.all([
      supabase
        .from("custom_field_values")
        .select("order_id, custom_field_id, value")
        .in("order_id", orderIds),

      // Chain asset fetch → signed URLs so thumbnails don't block other queries.
      supabase
        .from("assets")
        .select("order_id, storage_path, external_url, file_name, mime_type, created_at")
        .in("order_id", orderIds)
        .order("created_at", { ascending: true })
        .then(({ data }) =>
          thumbnailUrlsByOrder(
            (data ?? []) as OrderAssetPreviewRow[],
            async (paths) => {
              const { data: signed } = await supabase.storage
                .from("order-assets")
                .createSignedUrls(paths, 3600);
              return new Map(
                ((signed ?? []) as { path: string | null; signedUrl: string }[])
                  .filter((s) => s.path)
                  .map((s) => [s.path as string, s.signedUrl])
              );
            }
          )
        ),

      supabase
        .from("job_notifications")
        .select("order_id, type, channel, status, customer_response, created_at")
        .in("order_id", orderIds)
        .in("status", ["pending", "sent", "responded"])
        .order("created_at", { ascending: false }),

      creatorIds.length > 0
        ? supabase.from("profiles").select("id, full_name").in("id", creatorIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),

      uniqueDesignerIds.length > 0
        ? supabase.from("profiles").select("id, full_name").in("id", uniqueDesignerIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    ]);

  // Custom field values
  const fieldValuesByOrder: Record<string, Record<string, unknown>> = {};
  for (const v of (valuesRes.data ?? []) as {
    order_id: string;
    custom_field_id: string;
    value: unknown;
  }[]) {
    (fieldValuesByOrder[v.order_id] ??= {})[v.custom_field_id] = v.value;
  }

  // Notification badges
  const notificationBadgeByOrder: Record<string, CardNotificationBadge> = {};
  for (const row of (notifRes.data ?? []) as {
    order_id: string;
    type: NotificationType;
    channel: NotificationChannel;
    status: NotificationStatus;
    customer_response: CustomerResponse | null;
  }[]) {
    if (notificationBadgeByOrder[row.order_id]) continue;
    const badge = notificationToCardBadge(row.type, row.status, row.channel, row.customer_response);
    if (badge) notificationBadgeByOrder[row.order_id] = badge;
  }

  // Owner names: prefer created_by → profiles, fall back to specs.request_owner_name
  const ownerNameByOrder: Record<string, string> = {};
  const ownerNameById = new Map(
    ((ownerProfiles as { data: { id: string; full_name: string | null }[] | null }).data ?? []).map(
      (p) => [p.id, p.full_name?.trim() || "Staff member"]
    )
  );
  for (const o of orders) {
    if (o.created_by) {
      const name = ownerNameById.get(o.created_by);
      if (name) { ownerNameByOrder[o.id] = name; continue; }
    }
    const specName =
      typeof (o.specs as Record<string, unknown> | null)?.request_owner_name === "string"
        ? ((o.specs as Record<string, unknown>).request_owner_name as string).trim()
        : "";
    if (specName) ownerNameByOrder[o.id] = specName;
  }

  // Designer names
  const designerNameByOrder: Record<string, string> = { ...designerNameByOrderPre };
  const designerNameById = new Map(
    ((designerProfiles as { data: { id: string; full_name: string | null }[] | null }).data ?? []).map(
      (p) => [p.id, p.full_name?.trim() || "Designer"]
    )
  );
  for (const o of orders) {
    if (designerNameByOrder[o.id]) continue;
    const specs = o.specs as Record<string, unknown> | null;
    const id = typeof specs?.designer_id === "string" ? specs.designer_id.trim() : "";
    if (id) {
      const name = designerNameById.get(id);
      if (name) designerNameByOrder[o.id] = name;
    }
  }

  const response: ColumnOrdersResponse = {
    orders,
    fieldValuesByOrder,
    thumbnailByOrder,
    notificationBadgeByOrder,
    ownerNameByOrder,
    designerNameByOrder,
    hasMore,
    total,
    page,
  };

  return NextResponse.json(response);
}
