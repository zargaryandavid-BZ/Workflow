import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Board } from "@/components/board/board";
import { isPublicAppUrl } from "@/lib/notification-messages";
import { isSmsConfigured } from "@/lib/sms";
import {
  notificationToCardBadge,
  type CardNotificationBadge,
} from "@/lib/card-badges";
import {
  designerNamesByOrder,
  thumbnailUrlsByOrder,
  type OrderAssetPreviewRow,
} from "@/lib/board-card-previews";
import { loadOrdersWithRelations } from "@/lib/orders/load-with-relations";
import type {
  AutomationRule,
  BoardColumn,
  Category,
  CustomField,
  CustomerResponse,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  NotifyRuleConfig,
  OrderWithRelations,
} from "@/lib/types";

export default async function BoardPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/onboarding");

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const [
    columnsRes,
    fieldsRes,
    categoriesRes,
    designerMemberRes,
    rulesRes,
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
      .from("categories")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    supabase
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("role", "designer"),
    supabase
      .from("automation_rules")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("trigger", "on_enter_column"),
  ]);

  const orders = await loadOrdersWithRelations(supabase, tenantId);

  const boardColumns = (columnsRes.data ?? []) as BoardColumn[];
  const automationRules = (rulesRes.data ?? []) as AutomationRule[];

  const notifyColumns = boardColumns
    .filter((c) => c.kind === "approval" || c.kind === "exception")
    .map((col) => {
      const rule = automationRules.find(
        (r) =>
          r.from_column === col.id &&
          (r.config as Partial<NotifyRuleConfig>)?.action === "notify"
      );
      return {
        column_id: col.id,
        notify_type: (col.kind === "approval"
          ? "customer_approval"
          : "missing_info") as NotificationType,
        automation_enabled: rule?.enabled ?? false,
      };
    });

  // Resolve designer names (no FK between memberships and profiles, so fetch
  // the profiles separately).
  const designerIds = ((designerMemberRes.data ?? []) as { user_id: string }[]).map(
    (m) => m.user_id
  );
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

  const creatorIds = [
    ...new Set(
      orders
        .map((o) => o.created_by)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  let ownerNameByOrder: Record<string, string> = {};
  if (creatorIds.length > 0) {
    const { data: ownerProfiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", creatorIds);
    const ownerNameById = new Map(
      ((ownerProfiles ?? []) as { id: string; full_name: string | null }[]).map(
        (p) => [p.id, p.full_name?.trim() || "Staff member"]
      )
    );
    ownerNameByOrder = Object.fromEntries(
      orders
        .filter((o) => o.created_by)
        .map((o) => [
          o.id,
          ownerNameById.get(o.created_by as string) ?? "Staff member",
        ])
    );
  }

  const designerNameById = new Map(designers.map((d) => [d.id, d.name]));
  const designerNameByOrder = designerNamesByOrder(orders, designerNameById);

  // Custom field values for all orders on the board, grouped by order.
  const orderIds = orders.map((o) => o.id);
  const fieldValuesByOrder: Record<string, Record<string, unknown>> = {};
  if (orderIds.length > 0) {
    const { data: values } = await supabase
      .from("custom_field_values")
      .select("order_id, custom_field_id, value")
      .in("order_id", orderIds);
    for (const v of (values ?? []) as {
      order_id: string;
      custom_field_id: string;
      value: unknown;
    }[]) {
      (fieldValuesByOrder[v.order_id] ??= {})[v.custom_field_id] = v.value;
    }
  }

  let thumbnailByOrder: Record<string, string> = {};
  if (orderIds.length > 0) {
    const { data: assetRows } = await supabase
      .from("assets")
      .select(
        "order_id, storage_path, external_url, file_name, mime_type, created_at"
      )
      .in("order_id", orderIds)
      .order("created_at", { ascending: true });

    thumbnailByOrder = await thumbnailUrlsByOrder(
      (assetRows ?? []) as OrderAssetPreviewRow[],
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
    );
  }

  // Latest customer notification per order (missing info + approval).
  const notificationBadgeByOrder: Record<string, CardNotificationBadge> = {};
  if (orderIds.length > 0) {
    const { data: notifications } = await supabase
      .from("job_notifications")
      .select("order_id, type, channel, status, customer_response, created_at")
      .in("order_id", orderIds)
      .in("status", ["pending", "sent", "responded"])
      .order("created_at", { ascending: false });
    for (const row of (notifications ?? []) as {
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
  }

  return (
    <Board
      tenantId={tenantId}
      tenantName={ctx.tenant.name}
      role={ctx.role}
      columns={boardColumns}
      initialOrders={orders}
      categories={(categoriesRes.data ?? []) as Category[]}
      customFields={(fieldsRes.data ?? []) as CustomField[]}
      fieldValuesByOrder={fieldValuesByOrder}
      thumbnailByOrder={thumbnailByOrder}
      designerNameByOrder={designerNameByOrder}
      designers={designers}
      notifyColumns={notifyColumns}
      notificationBadgeByOrder={notificationBadgeByOrder}
      ownerNameByOrder={ownerNameByOrder}
      smsConfigured={isSmsConfigured()}
      publicAppUrl={isPublicAppUrl()}
    />
  );
}
