import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findWebhookConfigBySecret,
  touchWebhookLastUsed,
} from "@/lib/webhook-config";
import { secretsMatch } from "@/lib/webhook-order";
import { respondUrl } from "@/lib/notification-messages";
import { boardExportDetails } from "@/lib/board-export-details";
import type { ApprovalRow } from "@/lib/reorder-source";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;
const APPROVAL_CHUNK = 200;

type OrderRow = {
  id: string;
  title: string;
  column_id: string;
  position: number;
  updated_at: string | null;
  created_at: string;
  due_date: string | null;
  last_moved_at: string | null;
  specs: Record<string, unknown> | null;
};

/** Hold / Missing-info columns: the export carries the reason staff typed. */
function isHoldLikeColumn(name: string | null | undefined): boolean {
  if (typeof name !== "string") return false;
  const key = name.toLowerCase();
  return /\bhold\b/.test(key) || key.includes("missing") || key.includes("needs info");
}

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
 *
 * Each order row also carries OPTIONAL detail fields (additive, may be null):
 *   item_index, item_title, design_folder_url, production_notes,
 *   approval_url + approval_status (newest non-expired customer approval round:
 *   approved | rejected | pending), is_reorder, reorder_of,
 *   due_date (the card's production due date, YYYY-MM-DD, or null — Bazaar's
 *   board poller shows it as the portal "Due" date),
 *   hold_reason (newest Hold / Missing-info reason while the card sits in such a
 *   column, else null — the portal shows it as "We need: …").
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
    .select("id, title, column_id, position, updated_at, created_at, due_date, last_moved_at, specs", {
      count: "exact",
    })
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .order("column_id", { ascending: true })
    .order("position", { ascending: true })
    // Tie-breaker: many cards share a position inside a column, so without a
    // unique last key offset pages could repeat one card and skip another.
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (ordersError) {
    return NextResponse.json(
      { error: "Failed to load orders", detail: ordersError.message },
      { status: 500 }
    );
  }

  void touchWebhookLastUsed(adminClient, webhookConfig.id);

  // Optional per-card details (additive): newest non-expired customer approval
  // round per card, read in chunks. A failure here never fails the export — the
  // rows just carry null approval fields.
  const approvalsByOrder = new Map<string, ApprovalRow[]>();
  const orderIds = ((orders ?? []) as OrderRow[]).map((o) => o.id);
  for (let i = 0; i < orderIds.length; i += APPROVAL_CHUNK) {
    const chunk = orderIds.slice(i, i + APPROVAL_CHUNK);
    try {
      const { data: notes } = await adminClient
        .from("job_notifications")
        .select(
          "order_id, token, status, customer_response, channel, token_expires_at, created_at"
        )
        .eq("tenant_id", tenantId)
        .eq("type", "customer_approval")
        .in("order_id", chunk)
        .in("status", ["pending", "sent", "responded"]);
      for (const n of (notes ?? []) as (ApprovalRow & { order_id: string })[]) {
        const list = approvalsByOrder.get(n.order_id) ?? [];
        list.push(n);
        approvalsByOrder.set(n.order_id, list);
      }
    } catch (err) {
      console.error(
        "[export/board-columns] approval lookup failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  // Optional (additive): the newest Hold / Missing-info reason for cards sitting
  // in such a column, recorded since the card entered it (hold_reason activity).
  // A failure here never fails the export — the rows just carry null.
  const holdReasonByOrder = new Map<string, string>();
  const heldRows = ((orders ?? []) as OrderRow[]).filter((o) =>
    isHoldLikeColumn(columnById.get(o.column_id)?.name)
  );
  for (let i = 0; i < heldRows.length; i += APPROVAL_CHUNK) {
    const chunk = heldRows.slice(i, i + APPROVAL_CHUNK);
    try {
      const { data: acts } = await adminClient
        .from("activity_log")
        .select("order_id, metadata, created_at")
        .eq("tenant_id", tenantId)
        .eq("action", "hold_reason")
        .in("order_id", chunk.map((o) => o.id))
        .order("created_at", { ascending: false });
      const movedAt = new Map(chunk.map((o) => [o.id, o.last_moved_at]));
      for (const a of (acts ?? []) as {
        order_id: string;
        metadata: { reason?: unknown } | null;
        created_at: string;
      }[]) {
        if (holdReasonByOrder.has(a.order_id)) continue;
        const since = movedAt.get(a.order_id);
        // Allow a small clock slack: the reason is typed right after the move.
        if (since && Date.parse(a.created_at) < Date.parse(since) - 5_000) continue;
        const reason =
          typeof a.metadata?.reason === "string" ? a.metadata.reason.trim() : "";
        if (reason) holdReasonByOrder.set(a.order_id, reason.slice(0, 500));
      }
    } catch (err) {
      console.error(
        "[export/board-columns] hold reason lookup failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  const rows = ((orders ?? []) as OrderRow[]).map((order) => {
    const col = columnById.get(order.column_id);
    const details = boardExportDetails(
      order.specs,
      approvalsByOrder.get(order.id) ?? [],
      respondUrl
    );
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
      due_date:
        typeof order.due_date === "string" && order.due_date
          ? order.due_date.slice(0, 10)
          : null,
      // Why the card is held (Hold / Missing info), or null — the Bazaar portal
      // shows it to the partner as "We need: …".
      hold_reason: holdReasonByOrder.get(order.id) ?? null,
      ...details,
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
