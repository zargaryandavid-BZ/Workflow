import type { SupabaseClient } from "@supabase/supabase-js";
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

export interface BoardOrderEnrichment {
  fieldValuesByOrder: Record<string, Record<string, unknown>>;
  thumbnailByOrder: Record<string, string[]>;
  notificationBadgeByOrder: Record<string, CardNotificationBadge>;
  ownerNameByOrder: Record<string, string>;
  designerNameByOrder: Record<string, string>;
}

const emptyEnrichment = (): BoardOrderEnrichment => ({
  fieldValuesByOrder: {},
  thumbnailByOrder: {},
  notificationBadgeByOrder: {},
  ownerNameByOrder: {},
  designerNameByOrder: {},
});

export async function enrichBoardOrders(
  supabase: SupabaseClient,
  orders: OrderWithRelations[]
): Promise<BoardOrderEnrichment> {
  if (orders.length === 0) return emptyEnrichment();

  const orderIds = orders.map((o) => o.id);

  const creatorIds = [
    ...new Set(
      orders.map((o) => o.created_by).filter((id): id is string => Boolean(id))
    ),
  ];
  const designerIdsNeeded: string[] = [];
  const designerNameByOrderPre: Record<string, string> = {};
  for (const o of orders) {
    const specs = o.specs as Record<string, unknown> | null;
    const storedName =
      typeof specs?.designer_name === "string" ? specs.designer_name.trim() : "";
    if (storedName) {
      designerNameByOrderPre[o.id] = storedName;
    } else {
      const id =
        typeof specs?.designer_id === "string" ? specs.designer_id.trim() : "";
      if (id) designerIdsNeeded.push(id);
    }
  }
  const uniqueDesignerIds = [...new Set(designerIdsNeeded)];

  const [valuesRes, thumbnailByOrder, notifRes, ownerProfiles, designerProfiles] =
    await Promise.all([
      supabase
        .from("custom_field_values")
        .select("order_id, custom_field_id, value")
        .in("order_id", orderIds),

      Promise.all([
        supabase
          .from("order_sku_images")
          .select("order_id, storage_path, file_name, mime_type, position, created_at")
          .in("order_id", orderIds)
          .order("position", { ascending: true }),
        supabase
          .from("assets")
          .select("order_id, storage_path, external_url, file_name, mime_type, created_at")
          .in("order_id", orderIds)
          .order("created_at", { ascending: true }),
      ]).then(([skuImagesRes, assetsRes]) => {
        // SKU images first (by position), then general assets as fallback
        const skuRows = (skuImagesRes.data ?? []).map((r) => ({
          order_id: r.order_id as string,
          storage_path: r.storage_path as string | null,
          external_url: null,
          file_name: r.file_name as string,
          mime_type: r.mime_type as string | null,
          created_at: r.created_at as string,
        })) as OrderAssetPreviewRow[];
        const assetRows = (assetsRes.data ?? []) as OrderAssetPreviewRow[];
        const combined = [...skuRows, ...assetRows];
        return thumbnailUrlsByOrder(combined, async (paths) => {
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
        });
      }),

      supabase
        .from("job_notifications")
        .select(
          "order_id, type, channel, status, customer_response, created_at"
        )
        .in("order_id", orderIds)
        .in("status", ["pending", "sent", "responded"])
        .order("created_at", { ascending: false }),

      creatorIds.length > 0
        ? supabase.from("profiles").select("id, full_name").in("id", creatorIds)
        : Promise.resolve({
            data: [] as { id: string; full_name: string | null }[],
          }),

      uniqueDesignerIds.length > 0
        ? supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", uniqueDesignerIds)
        : Promise.resolve({
            data: [] as { id: string; full_name: string | null }[],
          }),
    ]);

  const fieldValuesByOrder: Record<string, Record<string, unknown>> = {};
  for (const v of (valuesRes.data ?? []) as {
    order_id: string;
    custom_field_id: string;
    value: unknown;
  }[]) {
    (fieldValuesByOrder[v.order_id] ??= {})[v.custom_field_id] = v.value;
  }

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

  const ownerNameByOrder: Record<string, string> = {};
  const ownerNameById = new Map(
    (
      (ownerProfiles as { data: { id: string; full_name: string | null }[] | null })
        .data ?? []
    ).map((p) => [p.id, p.full_name?.trim() || "Staff member"])
  );
  for (const o of orders) {
    if (o.created_by) {
      const name = ownerNameById.get(o.created_by);
      if (name) {
        ownerNameByOrder[o.id] = name;
        continue;
      }
    }
    const specName =
      typeof (o.specs as Record<string, unknown> | null)?.request_owner_name ===
      "string"
        ? (
            (o.specs as Record<string, unknown>).request_owner_name as string
          ).trim()
        : "";
    if (specName) ownerNameByOrder[o.id] = specName;
  }

  const designerNameByOrder: Record<string, string> = {
    ...designerNameByOrderPre,
  };
  const designerNameById = new Map(
    (
      (
        designerProfiles as {
          data: { id: string; full_name: string | null }[] | null;
        }
      ).data ?? []
    ).map((p) => [p.id, p.full_name?.trim() || "Designer"])
  );
  for (const o of orders) {
    if (designerNameByOrder[o.id]) continue;
    const specs = o.specs as Record<string, unknown> | null;
    const id =
      typeof specs?.designer_id === "string" ? specs.designer_id.trim() : "";
    if (id) {
      const name = designerNameById.get(id);
      if (name) designerNameByOrder[o.id] = name;
    }
  }

  return {
    fieldValuesByOrder,
    thumbnailByOrder,
    notificationBadgeByOrder,
    ownerNameByOrder,
    designerNameByOrder,
  };
}
