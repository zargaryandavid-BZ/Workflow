import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findWebhookConfigBySecret,
  touchWebhookLastUsed,
} from "@/lib/webhook-config";
import { secretsMatch } from "@/lib/webhook-order";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;

type OrderRow = {
  id: string;
  title: string;
  column_id: string;
  position: number;
  updated_at: string | null;
  created_at: string;
  specs: Record<string, unknown> | null;
};

type ColumnRow = {
  id: string;
  name: string;
  position: number;
};

function resolveOrderNumber(order: OrderRow): string {
  const fromSpecs =
    typeof order.specs?.webhook_order_number === "string"
      ? order.specs.webhook_order_number.trim()
      : "";
  if (fromSpecs) return fromSpecs;
  return order.title?.trim() || order.id;
}

function readSecret(request: NextRequest): string | null {
  const header = request.headers.get("x-webhook-secret")?.trim();
  if (header) return header;
  const query = request.nextUrl.searchParams.get("secret")?.trim();
  return query || null;
}

/**
 * CRM board export — GET /api/export/board-columns
 *
 * Returns every active board card with its current column name.
 *
 * Auth (same secret as inbound order webhook):
 *   Header: x-webhook-secret: wh_live_…
 *   or query: ?secret=wh_live_…  (prefer header; query may appear in logs)
 *
 * Optional query:
 *   limit  — max rows (default 2000, max 5000)
 *   offset — pagination offset (default 0)
 */
export async function GET(request: NextRequest) {
  const secret = readSecret(request);
  if (!secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let adminClient: ReturnType<typeof createAdminClient>;
  try {
    adminClient = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  const webhookConfig = await findWebhookConfigBySecret(adminClient, secret);
  if (!webhookConfig || !secretsMatch(secret, webhookConfig.secret_key)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limitRaw = Number.parseInt(
    request.nextUrl.searchParams.get("limit") ?? "",
    10
  );
  const offsetRaw = Number.parseInt(
    request.nextUrl.searchParams.get("offset") ?? "",
    10
  );
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, limitRaw))
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

  const tenantId = webhookConfig.tenant_id;

  const [{ data: tenant }, { data: columns, error: columnsError }] =
    await Promise.all([
      adminClient
        .from("tenants")
        .select("id, name")
        .eq("id", tenantId)
        .maybeSingle(),
      adminClient
        .from("board_columns")
        .select("id, name, position")
        .eq("tenant_id", tenantId)
        .order("position", { ascending: true }),
    ]);

  if (columnsError) {
    return NextResponse.json(
      { error: "Failed to load columns", detail: columnsError.message },
      { status: 500 }
    );
  }

  const columnById = new Map<string, ColumnRow>(
    ((columns ?? []) as ColumnRow[]).map((c) => [c.id, c])
  );

  const {
    data: orders,
    error: ordersError,
    count,
  } = await adminClient
    .from("orders")
    .select("id, title, column_id, position, updated_at, created_at, specs", {
      count: "exact",
    })
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .order("column_id", { ascending: true })
    .order("position", { ascending: true })
    .range(offset, offset + limit - 1);

  if (ordersError) {
    return NextResponse.json(
      { error: "Failed to load orders", detail: ordersError.message },
      { status: 500 }
    );
  }

  void touchWebhookLastUsed(adminClient, webhookConfig.id);

  const rows = ((orders ?? []) as OrderRow[]).map((order) => {
    const col = columnById.get(order.column_id);
    return {
      order_id: order.id,
      order_number: resolveOrderNumber(order),
      title: order.title,
      column_id: order.column_id,
      column_name: col?.name ?? null,
      column_position: col?.position ?? null,
      card_position: order.position,
      updated_at: order.updated_at,
      created_at: order.created_at,
    };
  });

  const total = count ?? rows.length;
  const nextOffset = offset + rows.length < total ? offset + rows.length : null;

  return NextResponse.json({
    tenant_id: tenantId,
    tenant_name: (tenant as { name?: string } | null)?.name ?? null,
    exported_at: new Date().toISOString(),
    count: rows.length,
    total,
    limit,
    offset,
    next_offset: nextOffset,
    columns: ((columns ?? []) as ColumnRow[]).map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
    })),
    orders: rows,
  });
}
