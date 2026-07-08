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

  // Verify the column belongs to this tenant before fetching orders.
  const { data: col } = await supabase
    .from("board_columns")
    .select("id")
    .eq("id", columnId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!col) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Paginated orders for the column, with customer + tag joins.
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

  // All enrichments fetched in parallel to minimise latency.
  const [valuesRes, assetRes, notifRes] = await Promise.all([
    supabase
      .from("custom_field_values")
      .select("order_id, custom_field_id, value")
      .in("order_id", orderIds),
    supabase
      .from("assets")
      .select(
        "order_id, storage_path, external_url, file_name, mime_type, created_at"
      )
      .in("order_id", orderIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("job_notifications")
      .select(
        "order_id, type, channel, status, customer_response, created_at"
      )
      .in("order_id", orderIds)
      .in("status", ["pending", "sent", "responded"])
      .order("created_at", { ascending: false }),
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

  // Thumbnails (signed storage URLs + external URLs)
  const thumbnailByOrder = await thumbnailUrlsByOrder(
    (assetRes.data ?? []) as OrderAssetPreviewRow[],
    async (paths) => {
      const { data: signed } = await supabase.storage
        .from("order-assets")
        .createSignedUrls(paths, 3600);
      return new Map(
        (
          (signed ?? []) as { path: string | null; signedUrl: string }[]
        )
          .filter((s) => s.path)
          .map((s) => [s.path as string, s.signedUrl])
      );
    }
  );

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
    const badge = notificationToCardBadge(
      row.type,
      row.status,
      row.channel,
      row.customer_response
    );
    if (badge) notificationBadgeByOrder[row.order_id] = badge;
  }

  // Owner names: prefer created_by → profiles, fall back to specs.request_owner_name
  const ownerNameByOrder: Record<string, string> = {};
  const creatorIds = [
    ...new Set(
      orders
        .map((o) => o.created_by)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const ownerNameById = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", creatorIds);
    for (const p of (profiles ?? []) as {
      id: string;
      full_name: string | null;
    }[]) {
      ownerNameById.set(p.id, p.full_name?.trim() || "Staff member");
    }
  }
  for (const o of orders) {
    if (o.created_by) {
      const name = ownerNameById.get(o.created_by);
      if (name) {
        ownerNameByOrder[o.id] = name;
        continue;
      }
    }
    const specName =
      typeof (o.specs as Record<string, unknown> | null)
        ?.request_owner_name === "string"
        ? (
            (o.specs as Record<string, unknown>)
              .request_owner_name as string
          ).trim()
        : "";
    if (specName) ownerNameByOrder[o.id] = specName;
  }

  // Designer names: prefer specs.designer_name, fall back to profiles lookup
  const designerNameByOrder: Record<string, string> = {};
  const designerIdsNeeded: string[] = [];
  for (const o of orders) {
    const specs = o.specs as Record<string, unknown> | null;
    const storedName =
      typeof specs?.designer_name === "string"
        ? specs.designer_name.trim()
        : "";
    if (storedName) {
      designerNameByOrder[o.id] = storedName;
    } else {
      const id =
        typeof specs?.designer_id === "string" ? specs.designer_id.trim() : "";
      if (id) designerIdsNeeded.push(id);
    }
  }
  if (designerIdsNeeded.length > 0) {
    const uniqueIds = [...new Set(designerIdsNeeded)];
    const { data: designerProfiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", uniqueIds);
    const nameById = new Map(
      (
        (designerProfiles ?? []) as { id: string; full_name: string | null }[]
      ).map((p) => [p.id, p.full_name?.trim() || "Designer"])
    );
    for (const o of orders) {
      if (designerNameByOrder[o.id]) continue;
      const specs = o.specs as Record<string, unknown> | null;
      const id =
        typeof specs?.designer_id === "string" ? specs.designer_id.trim() : "";
      if (id) {
        const name = nameById.get(id);
        if (name) designerNameByOrder[o.id] = name;
      }
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
