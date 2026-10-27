import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findWebhookConfigBySecret,
  touchWebhookLastUsed,
} from "@/lib/webhook-config";
import { secretsMatch } from "@/lib/webhook-order";
import { performOrderMove } from "@/lib/orders/move-order.server";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Moves an integration may make with the shared secret. Deliberately narrow:
 * Pulse "Approve to Production" moves a card from Prepress to In Production and
 * nothing else — any other move still needs a staff user on the board.
 */
const ALLOWED_MOVES: Record<string, string[]> = {
  "in production": ["prepress"],
};

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/**
 * Integration card move — POST /api/export/move-card
 *
 * Body: { order_id: <uuid from /api/export/board-columns>, to_column: "In Production" }
 * Auth: x-webhook-secret header (same secret as the board export). Tenant-scoped.
 *
 * Runs the exact same move as a staff drag (lib/orders/move-order.server.ts):
 * lock check, required-field check, activity log, column automations, notification
 * rules, Bazaar portal status. Actor is recorded as null (integration).
 *
 * 200 { moved: true, order } | 200 { moved: false, already: true } when already there
 * 409 card is not in an allowed source column | 422 missing required fields
 * 423 card locked | 400/401/404 bad input / auth / not found
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-webhook-secret")?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  const webhookConfig = await findWebhookConfigBySecret(admin, secret);
  if (!webhookConfig || !secretsMatch(secret, webhookConfig.secret_key)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = webhookConfig.tenant_id;

  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
    to_column?: string;
  };
  const orderId = String(body.order_id ?? "").trim();
  const toName = norm(body.to_column);
  if (!UUID_RE.test(orderId) || !toName) {
    return NextResponse.json(
      { error: "order_id (uuid) and to_column are required" },
      { status: 400 }
    );
  }
  const allowedFrom = ALLOWED_MOVES[toName];
  if (!allowedFrom) {
    return NextResponse.json(
      { error: `Moving to "${body.to_column}" is not allowed for integrations` },
      { status: 400 }
    );
  }

  const [{ data: order }, { data: columns }, { data: tenant }] = await Promise.all([
    admin
      .from("orders")
      .select("id, column_id, removed_at")
      .eq("id", orderId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin
      .from("board_columns")
      .select("id, name")
      .eq("tenant_id", tenantId),
    admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
  ]);
  if (!order || order.removed_at) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const cols = (columns ?? []) as { id: string; name: string }[];
  const target = cols.find((c) => norm(c.name) === toName);
  if (!target) {
    return NextResponse.json(
      { error: `Column "${body.to_column}" not found` },
      { status: 404 }
    );
  }
  if (order.column_id === target.id) {
    return NextResponse.json({ moved: false, already: true });
  }
  const current = cols.find((c) => c.id === order.column_id);
  if (!current || !allowedFrom.includes(norm(current.name))) {
    return NextResponse.json(
      {
        error: `Card is in "${current?.name ?? "unknown"}", not ${allowedFrom.join("/")} — not moved`,
        current_column: current?.name ?? null,
      },
      { status: 409 }
    );
  }

  const result = await performOrderMove(admin, {
    tenantId,
    tenantName: (tenant as { name?: string } | null)?.name ?? "",
    actorUserId: null,
    actorRole: null,
    orderId,
    toColumnId: target.id,
    bypassDropRoles: true,
  });

  void touchWebhookLastUsed(admin, webhookConfig.id);

  if (result.status !== 200) {
    return NextResponse.json(result.body, { status: result.status });
  }
  return NextResponse.json({ moved: true, ...result.body });
}
