import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Board } from "@/components/board/board";
import { isPublicAppUrl } from "@/lib/notification-messages";
import { isSmsConfigured } from "@/lib/sms";
import { loadAccountManagerOwners } from "@/lib/order-owners";
import { loadButtonAutomations } from "@/lib/button-automations.server";
import { isColumnVisibleToUser } from "@/lib/columns";
import { loadFastActionButtons } from "@/lib/fast-action-buttons.server";
import { loadEnabledCardWarningRules } from "@/lib/card-warning-rules.server";
import type {
  AutomationRule,
  BoardColumn,
  CardWarningRule,
  Tag,
  CustomField,
  NotificationType,
  NotifyRuleConfig,
} from "@/lib/types";
import {
  DEFAULT_WEBHOOK_SOURCE_STYLES,
  normalizeWebhookSourceStyles,
  type WebhookSourceStyles,
} from "@/lib/webhook-source-styles";
import {
  countDesignerLoads,
  designerLoadColumnIds,
} from "@/lib/designer-load";
import type { Designer } from "@/lib/types";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/onboarding");

  const { order: initialOrderId } = await searchParams;

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  // Fast parallel fetch — columns + config only, no orders.
  // Orders are loaded lazily per-column by the client Board component.
  const [columnsRes, fieldsRes, tagsRes, memberRes, rulesRes, webhookRes] =
    await Promise.all([
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
        .from("tags")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("position", { ascending: true }),
      supabase
        .from("memberships")
        .select("user_id, role")
        .eq("tenant_id", tenantId),
      supabase
        .from("automation_rules")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("trigger", "on_enter_column"),
      supabase
        .from("webhook_configs")
        .select("source_styles")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);

  const webhookSourceStyles: WebhookSourceStyles = normalizeWebhookSourceStyles(
    (webhookRes.data as { source_styles?: unknown } | null)?.source_styles ??
      DEFAULT_WEBHOOK_SOURCE_STYLES
  );

  const allBoardColumns = (columnsRes.data ?? []) as BoardColumn[];
  const boardColumns = allBoardColumns.filter((col) =>
    isColumnVisibleToUser(col, ctx.role, ctx.userId)
  );

  const automationRules = (rulesRes.data ?? []) as AutomationRule[];
  const notifyColumns = boardColumns
    .filter(
      (c) =>
        c.kind === "approval" ||
        c.kind === "exception" ||
        c.kind === "ready_to_ship"
    )
    .map((col) => {
      const rule = automationRules.find(
        (r) =>
          r.from_column === col.id &&
          (r.config as Partial<NotifyRuleConfig>)?.action === "notify"
      );
      const notifyType: NotificationType =
        col.kind === "approval"
          ? "customer_approval"
          : col.kind === "ready_to_ship"
            ? "ready_to_ship"
            : "missing_info";
      // ready_to_ship columns always show the popup (it's intrinsic to the kind);
      // approval/exception columns require an explicit enabled automation rule.
      const automationEnabled =
        col.kind === "ready_to_ship" ? true : (rule?.enabled ?? false);
      return {
        column_id: col.id,
        notify_type: notifyType,
        automation_enabled: automationEnabled,
      };
    });

  const memberRows = (memberRes.data ?? []) as {
    user_id: string;
    role: string;
  }[];
  const designerIds = memberRows
    .filter((m) => m.role === "designer")
    .map((m) => m.user_id);

  let designers: Designer[] = [];
  if (designerIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", designerIds);
    const nameById = new Map(
      (
        (profiles ?? []) as { id: string; full_name: string | null }[]
      ).map((p) => [p.id, p.full_name])
    );
    designers = designerIds.map((id) => ({
      id,
      name: nameById.get(id) ?? "Unnamed designer",
      load: 0,
    }));

    // Active load = jobs currently in Start + In Progress columns.
    const loadColIds = designerLoadColumnIds(allBoardColumns);
    if (loadColIds.length > 0) {
      const { data: loadOrders } = await supabase
        .from("orders")
        .select("column_id, specs")
        .eq("tenant_id", tenantId)
        .is("removed_at", null)
        .in("column_id", loadColIds);
      const counts = countDesignerLoads(
        designerIds,
        (loadOrders ?? []) as {
          column_id: string;
          specs?: Record<string, unknown> | null;
        }[],
        loadColIds
      );
      designers = designers.map((d) => ({
        ...d,
        load: counts.get(d.id) ?? 0,
      }));
    }
  }

  const [owners, buttonAutomations, fastActionButtons, warningRules] =
    await Promise.all([
      loadAccountManagerOwners(supabase, tenantId),
      loadButtonAutomations(supabase, tenantId),
      loadFastActionButtons(supabase, tenantId),
      loadEnabledCardWarningRules(supabase, tenantId),
    ]);

  const tenant = ctx.tenant;

  return (
    <Board
      tenantId={tenantId}
      tenantName={ctx.tenant.name}
      warningAnimationOpacity={tenant.warning_opacity ?? 30}
      warningAnimationSpeedMs={tenant.warning_speed_ms ?? 2500}
      warningAnimationSpreadPx={tenant.warning_spread_px ?? 3}
      warningWorkingDays={tenant.warning_working_days ?? [1, 2, 3, 4, 5]}
      role={ctx.role}
      columns={boardColumns}
      tags={(tagsRes.data ?? []) as Tag[]}
      owners={owners}
      currentUserId={ctx.userId}
      currentUserName={ctx.fullName ?? ctx.email ?? "Unknown"}
      customFields={(fieldsRes.data ?? []) as CustomField[]}
      designers={designers}
      notifyColumns={notifyColumns}
      smsConfigured={isSmsConfigured()}
      publicAppUrl={isPublicAppUrl()}
      buttonAutomations={buttonAutomations}
      fastActionButtons={fastActionButtons}
      warningRules={warningRules as CardWarningRule[]}
      webhookSourceStyles={webhookSourceStyles}
      initialOrderId={initialOrderId ?? null}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
    />
  );
}
