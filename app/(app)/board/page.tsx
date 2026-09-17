import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizeEmergencyBalance } from "@/lib/emergency-balance";
import { Board } from "@/components/board/board";
import { isPublicAppUrl } from "@/lib/notification-messages";
import { appOrigin } from "@/lib/app-url";
import { isSmsConfigured } from "@/lib/sms";
import {
  loadAccountManagerOwners,
  type OrderOwnerOption,
} from "@/lib/order-owners";
import { loadButtonAutomations } from "@/lib/button-automations.server";
import { isColumnVisibleToUser } from "@/lib/columns";
import { loadFastActionButtons } from "@/lib/fast-action-buttons.server";
import { loadEnabledCardWarningRules } from "@/lib/card-warning-rules.server";
import type {
  AutomationRule,
  BoardColumn,
  ButtonAutomation,
  CardWarningRule,
  Designer,
  FastActionButton,
  Tag,
  CustomField,
  NotificationType,
  NotifyRuleConfig,
} from "@/lib/types";
import {
  DEFAULT_WEBHOOK_SOURCE_STYLES,
  ensurePortalSourceStyle,
  normalizeWebhookSourceStyles,
  type WebhookSourceStyles,
} from "@/lib/webhook-source-styles";
import {
  countDesignerLoads,
  designerLoadColumnIds,
} from "@/lib/designer-load";
import { listTimeChips } from "@/lib/time-chips.server";
import type { TimeChip } from "@/lib/time-chips";

function boardAux<T>(
  promise: Promise<T>,
  fallback: T,
  label: string
): Promise<T> {
  return promise.catch((err) => {
    console.error(`[board] ${label}`, err);
    return fallback;
  });
}

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

  // Start Round-2 fetches that have no Round-1 dependencies immediately,
  // so they run in parallel with Round 1 instead of waiting for it to finish.
  const ownersPromise = boardAux(
    loadAccountManagerOwners(supabase, tenantId),
    [] as OrderOwnerOption[],
    "owners"
  );
  const buttonAutomationsPromise = boardAux(
    loadButtonAutomations(supabase, tenantId),
    [] as ButtonAutomation[],
    "button-automations"
  );
  const fastActionButtonsPromise = boardAux(
    loadFastActionButtons(supabase, tenantId),
    [] as FastActionButton[],
    "fast-action-buttons"
  );
  const warningRulesPromise = boardAux(
    loadEnabledCardWarningRules(supabase, tenantId),
    [] as CardWarningRule[],
    "warning-rules"
  );
  const timeChipsPromise = boardAux(
    listTimeChips(supabase, tenantId),
    [] as TimeChip[],
    "time-chips"
  );

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

  const webhookSourceStyles: WebhookSourceStyles = ensurePortalSourceStyle(
    normalizeWebhookSourceStyles(
      (webhookRes.data as { source_styles?: unknown } | null)?.source_styles ??
        DEFAULT_WEBHOOK_SOURCE_STYLES
    )
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
  const loadColIds = designerLoadColumnIds(allBoardColumns);

  // Round 2: designers query (needs memberships + columns from Round 1).
  // The other Round-2 fetches were already started before Round 1 above.
  const designers = await (async (): Promise<Designer[]> => {
    if (designerIds.length === 0) return [];

    const [profilesRes, loadOrdersRes] = await Promise.all([
      supabase.from("profiles").select("id, full_name").in("id", designerIds),
      loadColIds.length > 0
        ? supabase
            .from("orders")
            .select("column_id, specs")
            .eq("tenant_id", tenantId)
            .is("removed_at", null)
            .in("column_id", loadColIds)
        : Promise.resolve({ data: [] as { column_id: string; specs?: Record<string, unknown> | null }[] }),
    ]);

    const nameById = new Map(
      (
        (profilesRes.data ?? []) as { id: string; full_name: string | null }[]
      ).map((p) => [p.id, p.full_name])
    );
    const counts =
      loadColIds.length > 0
        ? countDesignerLoads(
            designerIds,
            (loadOrdersRes.data ?? []) as {
              column_id: string;
              specs?: Record<string, unknown> | null;
            }[],
            loadColIds
          )
        : new Map<string, { load: number; skuCount: number }>();

    return designerIds.map((id) => {
      const stats = counts.get(id);
      return {
        id,
        name: nameById.get(id) ?? "Unnamed designer",
        load: stats?.load ?? 0,
        skuCount: stats?.skuCount ?? 0,
      };
    });
  })();

  // Await the already-in-flight independent fetches started before Round 1.
  const [owners, buttonAutomations, fastActionButtons, warningRules, timeChipsResult] =
    await Promise.all([
      ownersPromise,
      buttonAutomationsPromise,
      fastActionButtonsPromise,
      warningRulesPromise,
      timeChipsPromise,
    ]);

  // Migration 0060 may not be applied yet — cards fall back to legacy chips.
  const timeChips = timeChipsResult;

  const tenant = ctx.tenant;

  return (
    <Board
      tenantId={tenantId}
      tenantName={ctx.tenant.name}
      warningAnimationOpacity={tenant.warning_opacity ?? 30}
      warningAnimationSpeedMs={tenant.warning_speed_ms ?? 2500}
      warningAnimationSpreadPx={tenant.warning_spread_px ?? 3}
      warningWorkingDays={tenant.warning_working_days ?? [1, 2, 3, 4, 5]}
      emergencyBalance={normalizeEmergencyBalance(
        tenant.emergency_balance,
        boardColumns.map((c) => ({ id: c.id, name: c.name }))
      )}
      role={ctx.role}
      columns={boardColumns}
      tags={(tagsRes.data ?? []) as Tag[]}
      owners={owners}
      currentUserId={ctx.userId}
      currentUserName={ctx.fullName ?? ctx.email ?? "Unknown"}
      customFields={(fieldsRes.data ?? []) as CustomField[]}
      tenantIntegrationMode={
        ctx.tenant.integration_mode === "connected" ? "connected" : "local"
      }
      designers={designers}
      notifyColumns={notifyColumns}
      smsConfigured={isSmsConfigured()}
      publicAppUrl={isPublicAppUrl()}
      buttonAutomations={buttonAutomations}
      fastActionButtons={fastActionButtons}
      warningRules={warningRules as CardWarningRule[]}
      webhookSourceStyles={webhookSourceStyles}
      timeChips={timeChips}
      initialOrderId={initialOrderId ?? null}
      appUrl={appOrigin()}
    />
  );
}
