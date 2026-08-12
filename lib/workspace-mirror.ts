/**
 * Cross-workspace order mirroring.
 *
 * Specs stamp on both cards:
 *   specs.workspace_mirror = {
 *     role: "source" | "mirror",
 *     link_id, rule_id,
 *     peer_order_id, peer_tenant_id
 *   }
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/automation";
import type { Order } from "@/lib/types";

export type WorkspaceMirrorRole = "source" | "mirror";

export interface WorkspaceMirrorSpec {
  role: WorkspaceMirrorRole;
  link_id: string;
  rule_id: string;
  peer_order_id: string;
  peer_tenant_id: string;
}

export interface WorkspaceLinkRow {
  id: string;
  source_tenant_id: string;
  target_tenant_id: string;
  enabled: boolean;
  created_at: string;
}

export interface WorkspaceLinkRuleRow {
  id: string;
  link_id: string;
  trigger_column_id: string;
  mirror_start_column_id: string;
  return_column_id: string | null;
  return_to_column_id: string | null;
  enabled: boolean;
  created_at: string;
}

export function readWorkspaceMirrorSpec(
  specs: unknown
): WorkspaceMirrorSpec | null {
  if (!specs || typeof specs !== "object") return null;
  const raw = (specs as Record<string, unknown>).workspace_mirror;
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.role !== "source" && m.role !== "mirror") return null;
  if (
    typeof m.link_id !== "string" ||
    typeof m.rule_id !== "string" ||
    typeof m.peer_order_id !== "string" ||
    typeof m.peer_tenant_id !== "string"
  ) {
    return null;
  }
  return {
    role: m.role,
    link_id: m.link_id,
    rule_id: m.rule_id,
    peer_order_id: m.peer_order_id,
    peer_tenant_id: m.peer_tenant_id,
  };
}

function withMirrorSpec(
  specs: Record<string, unknown> | null | undefined,
  mirror: WorkspaceMirrorSpec
): Record<string, unknown> {
  return {
    ...(specs ?? {}),
    workspace_mirror: mirror,
  };
}

/**
 * After an order enters a column: create a mirror (outbound) or return the
 * original (inbound). Uses service role for cross-tenant writes.
 */
export async function processWorkspaceMirrorOnEnter(
  order: Order,
  enteredColumnId: string,
  actorUserId: string | null
): Promise<void> {
  const existing = readWorkspaceMirrorSpec(order.specs);

  // Return path: mirror hit its return column → move original in source.
  if (existing?.role === "mirror") {
    await maybeReturnOriginal(order, enteredColumnId, existing, actorUserId);
    return;
  }

  // Already mirrored from this order — don't create again.
  if (existing?.role === "source" && existing.peer_order_id) {
    return;
  }

  await maybeCreateMirror(order, enteredColumnId, actorUserId);
}

async function maybeCreateMirror(
  order: Order,
  enteredColumnId: string,
  actorUserId: string | null
): Promise<void> {
  const admin = createAdminClient();

  const { data: links, error: linksErr } = await admin
    .from("workspace_links")
    .select("id, source_tenant_id, target_tenant_id, enabled")
    .eq("source_tenant_id", order.tenant_id)
    .eq("enabled", true);

  if (linksErr) {
    console.error("[workspace-mirror] load links:", linksErr.message);
    return;
  }
  if (!links?.length) return;

  const linkIds = links.map((l) => l.id as string);
  const { data: rules, error: rulesErr } = await admin
    .from("workspace_link_rules")
    .select(
      "id, link_id, trigger_column_id, mirror_start_column_id, return_column_id, return_to_column_id, enabled"
    )
    .in("link_id", linkIds)
    .eq("trigger_column_id", enteredColumnId)
    .eq("enabled", true);

  if (rulesErr) {
    console.error("[workspace-mirror] load trigger rules:", rulesErr.message);
    return;
  }
  if (!rules?.length) return;

  const linkById = new Map(links.map((l) => [l.id as string, l]));

  for (const row of rules) {
    const link = linkById.get(row.link_id as string);
    if (!link?.enabled) continue;

    try {
      await createMirrorCard(admin, {
        source: order,
        linkId: link.id as string,
        ruleId: row.id as string,
        targetTenantId: link.target_tenant_id as string,
        mirrorStartColumnId: row.mirror_start_column_id as string,
        actorUserId,
      });
      // One mirror per enter is enough (first matching rule).
      break;
    } catch (err) {
      console.error(
        "[workspace-mirror] create failed:",
        err instanceof Error ? err.message : err
      );
    }
  }
}

async function createMirrorCard(
  admin: SupabaseClient,
  opts: {
    source: Order;
    linkId: string;
    ruleId: string;
    targetTenantId: string;
    mirrorStartColumnId: string;
    actorUserId: string | null;
  }
): Promise<void> {
  const { source, linkId, ruleId, targetTenantId, mirrorStartColumnId, actorUserId } =
    opts;

  // Re-check source hasn't been linked since we loaded it.
  const { data: fresh } = await admin
    .from("orders")
    .select("id, specs")
    .eq("id", source.id)
    .maybeSingle();
  if (readWorkspaceMirrorSpec(fresh?.specs)?.peer_order_id) return;

  const { data: lastInCol } = await admin
    .from("orders")
    .select("position")
    .eq("column_id", mirrorStartColumnId)
    .eq("tenant_id", targetTenantId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position =
    ((lastInCol as { position?: number } | null)?.position ?? 0) + 1000;

  const sourceSpecs =
    source.specs && typeof source.specs === "object"
      ? ({ ...(source.specs as Record<string, unknown>) } as Record<
          string,
          unknown
        >)
      : {};
  // Don't copy an existing mirror stamp into the new card.
  delete sourceSpecs.workspace_mirror;

  const { data: mirror, error: insertErr } = await admin
    .from("orders")
    .insert({
      tenant_id: targetTenantId,
      column_id: mirrorStartColumnId,
      title: source.title,
      description: source.description,
      internal_note: source.internal_note,
      priority: source.priority ?? "normal",
      due_date: source.due_date,
      tag_id: null,
      customer_id: null,
      specs: sourceSpecs,
      position,
      created_by: actorUserId,
      last_moved_at: new Date().toISOString(),
      webhook_source: source.webhook_source ?? null,
    })
    .select("id")
    .single();

  if (insertErr || !mirror) {
    throw new Error(insertErr?.message ?? "Failed to insert mirror order");
  }

  const mirrorId = mirror.id as string;

  const sourceStamp: WorkspaceMirrorSpec = {
    role: "source",
    link_id: linkId,
    rule_id: ruleId,
    peer_order_id: mirrorId,
    peer_tenant_id: targetTenantId,
  };
  const mirrorStamp: WorkspaceMirrorSpec = {
    role: "mirror",
    link_id: linkId,
    rule_id: ruleId,
    peer_order_id: source.id,
    peer_tenant_id: source.tenant_id,
  };

  await Promise.all([
    admin
      .from("orders")
      .update({
        specs: withMirrorSpec(
          source.specs as Record<string, unknown> | null,
          sourceStamp
        ),
      })
      .eq("id", source.id)
      .eq("tenant_id", source.tenant_id),
    admin
      .from("orders")
      .update({
        specs: withMirrorSpec(sourceSpecs, mirrorStamp),
      })
      .eq("id", mirrorId)
      .eq("tenant_id", targetTenantId),
  ]);

  // Copy custom field values where field names match in the target tenant.
  await copyMatchingCustomFields(admin, source.id, source.tenant_id, mirrorId, targetTenantId);

  await Promise.all([
    logActivity(admin, {
      tenantId: source.tenant_id,
      orderId: source.id,
      actor: actorUserId,
      action: "workspace_mirror_created",
      metadata: {
        mirror_order_id: mirrorId,
        target_tenant_id: targetTenantId,
        rule_id: ruleId,
      },
    }),
    logActivity(admin, {
      tenantId: targetTenantId,
      orderId: mirrorId,
      actor: actorUserId,
      action: "workspace_mirror_received",
      metadata: {
        source_order_id: source.id,
        source_tenant_id: source.tenant_id,
        rule_id: ruleId,
      },
    }),
  ]);
}

async function copyMatchingCustomFields(
  admin: SupabaseClient,
  sourceOrderId: string,
  sourceTenantId: string,
  mirrorOrderId: string,
  targetTenantId: string
): Promise<void> {
  const [{ data: sourceFields }, { data: targetFields }, { data: values }] =
    await Promise.all([
      admin
        .from("custom_fields")
        .select("id, name")
        .eq("tenant_id", sourceTenantId),
      admin
        .from("custom_fields")
        .select("id, name")
        .eq("tenant_id", targetTenantId),
      admin
        .from("custom_field_values")
        .select("custom_field_id, value")
        .eq("order_id", sourceOrderId),
    ]);

  if (!values?.length || !sourceFields?.length || !targetFields?.length) return;

  const sourceNameById = new Map(
    (sourceFields as { id: string; name: string }[]).map((f) => [
      f.id,
      f.name.trim().toLowerCase(),
    ])
  );
  const targetIdByName = new Map(
    (targetFields as { id: string; name: string }[]).map((f) => [
      f.name.trim().toLowerCase(),
      f.id,
    ])
  );

  const rows: { order_id: string; custom_field_id: string; value: unknown }[] =
    [];
  for (const v of values as { custom_field_id: string; value: unknown }[]) {
    const name = sourceNameById.get(v.custom_field_id);
    if (!name) continue;
    const targetFieldId = targetIdByName.get(name);
    if (!targetFieldId) continue;
    rows.push({
      order_id: mirrorOrderId,
      custom_field_id: targetFieldId,
      value: v.value,
    });
  }
  if (rows.length === 0) return;
  await admin.from("custom_field_values").insert(rows);
}

async function maybeReturnOriginal(
  mirror: Order,
  enteredColumnId: string,
  existing: WorkspaceMirrorSpec,
  actorUserId: string | null
): Promise<void> {
  const admin = createAdminClient();

  const { data: rule } = await admin
    .from("workspace_link_rules")
    .select("id, return_column_id, return_to_column_id, enabled, link_id")
    .eq("id", existing.rule_id)
    .maybeSingle();

  if (!rule?.enabled) return;
  if (!rule.return_column_id || !rule.return_to_column_id) return;
  if (rule.return_column_id !== enteredColumnId) return;

  const { data: link } = await admin
    .from("workspace_links")
    .select("id, enabled")
    .eq("id", rule.link_id)
    .maybeSingle();
  if (!link?.enabled) return;

  const { data: original } = await admin
    .from("orders")
    .select("id, tenant_id, column_id, removed_at")
    .eq("id", existing.peer_order_id)
    .eq("tenant_id", existing.peer_tenant_id)
    .maybeSingle();

  if (!original || original.removed_at) return;
  if (original.column_id === rule.return_to_column_id) return;

  const { data: lastInCol } = await admin
    .from("orders")
    .select("position")
    .eq("column_id", rule.return_to_column_id)
    .eq("tenant_id", existing.peer_tenant_id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position =
    ((lastInCol as { position?: number } | null)?.position ?? 0) + 1000;

  const { error } = await admin
    .from("orders")
    .update({
      column_id: rule.return_to_column_id,
      position,
      last_moved_at: new Date().toISOString(),
    })
    .eq("id", original.id)
    .eq("tenant_id", existing.peer_tenant_id);

  if (error) {
    console.error("[workspace-mirror] return move failed:", error.message);
    return;
  }

  await Promise.all([
    logActivity(admin, {
      tenantId: existing.peer_tenant_id,
      orderId: original.id as string,
      actor: actorUserId,
      action: "workspace_mirror_returned",
      metadata: {
        mirror_order_id: mirror.id,
        from_column_id: original.column_id,
        to_column_id: rule.return_to_column_id,
        rule_id: existing.rule_id,
      },
    }),
    logActivity(admin, {
      tenantId: mirror.tenant_id,
      orderId: mirror.id,
      actor: actorUserId,
      action: "workspace_mirror_completed",
      metadata: {
        source_order_id: original.id,
        return_to_column_id: rule.return_to_column_id,
        rule_id: existing.rule_id,
      },
    }),
  ]);
}
