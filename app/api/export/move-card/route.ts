import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findWebhookConfigBySecret,
  touchWebhookLastUsed,
} from "@/lib/webhook-config";
import { secretsMatch } from "@/lib/webhook-order";
import { performOrderMove } from "@/lib/orders/move-order.server";
import {
  decideIntegrationMove,
  findColumnByName,
  parseMoveCardBody,
} from "@/lib/orders/move-card-request";

export const dynamic = "force-dynamic";

function readSecret(request: NextRequest): string | null {
  const header = request.headers.get("x-webhook-secret")?.trim();
  return header || null;
}

/**
 * Card move for integrations — POST /api/export/move-card
 *
 * Used by Pulse "Approve to Production": once prepress approves a job there, its Workflow card
 * moves Prepress → In Production. Same checks and side effects as dragging the card on the board
 * (required fields, lock, activity log, column automations, notifications, portal status).
 *
 * Auth: header `x-webhook-secret: wh_live_…` (same secret as the other /api/export routes).
 * Body: { "order_id": "<card uuid>", "to_column": "In Production" }
 *
 * Only Prepress → In Production is accepted. Responses:
 *   200 { ok: true, moved: true }                      — moved
 *   200 { ok: true, moved: false, already: true }      — card already in In Production
 *   422 { ok: false, error, missing_fields: [...] }    — card is missing required fields
 *   409 / 403 / 404 / 423                               — not in Prepress / wrong target / unknown card / locked
 */
export async function POST(request: NextRequest) {
  const secret = readSecret(request);
  if (!secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let adminClient: ReturnType<typeof createAdminClient>;
  try {
    adminClient = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }

  const webhookConfig = await findWebhookConfigBySecret(adminClient, secret);
  if (!webhookConfig || !secretsMatch(secret, webhookConfig.secret_key)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseMoveCardBody(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const { orderId, toColumn } = parsed.value;
  const tenantId = webhookConfig.tenant_id;

  const [{ data: tenant }, { data: columns, error: columnsError }, { data: order }] =
    await Promise.all([
      adminClient.from("tenants").select("id, name").eq("id", tenantId).maybeSingle(),
      adminClient
        .from("board_columns")
        .select("id, name")
        .eq("tenant_id", tenantId),
      adminClient
        .from("orders")
        .select("id, column_id, removed_at")
        .eq("id", orderId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);
  if (columnsError) {
    return NextResponse.json(
      { ok: false, error: "Failed to load columns", detail: columnsError.message },
      { status: 500 }
    );
  }
  if (!order || order.removed_at) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  const columnList = (columns ?? []) as { id: string; name: string }[];
  const target = findColumnByName(columnList, toColumn);
  if (!target) {
    return NextResponse.json({ ok: false, error: `Column "${toColumn}" not found` }, { status: 404 });
  }
  const current = columnList.find((c) => c.id === order.column_id);

  const decision = decideIntegrationMove(current?.name ?? "", target.name);
  if (!decision.allowed) {
    return NextResponse.json({ ok: false, error: decision.error }, { status: decision.status });
  }
  void touchWebhookLastUsed(adminClient, webhookConfig.id);
  if (decision.already) {
    return NextResponse.json({ ok: true, moved: false, already: true });
  }

  const result = await performOrderMove(adminClient, {
    tenantId,
    tenantName: tenant?.name ?? "",
    actorUserId: null,
    actorRole: null,
    orderId,
    toColumnId: target.id,
    // The route already restricted this to Prepress → In Production, so the board's drop-role check is skipped.
    skipDropPermission: true,
  });

  if (result.status >= 200 && result.status < 300) {
    return NextResponse.json({ ok: true, moved: true });
  }
  return NextResponse.json({ ok: false, ...result.body }, { status: result.status });
}
