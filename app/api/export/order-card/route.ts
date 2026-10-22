import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findWebhookConfigBySecret,
  touchWebhookLastUsed,
} from "@/lib/webhook-config";
import { secretsMatch } from "@/lib/webhook-order";
import { loadOrderExportData } from "@/lib/button-automation-order-data";
import { orderCardExport, type OrderCardExport } from "@/lib/order-card-export";

export const dynamic = "force-dynamic";

const MAX_IDS = 25;
const CONCURRENCY = 4;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readSecret(request: NextRequest): string | null {
  const header = request.headers.get("x-webhook-secret")?.trim();
  if (header) return header;
  const query = request.nextUrl.searchParams.get("secret")?.trim();
  return query || null;
}

/**
 * Full card details — GET /api/export/order-card?order_ids=<uuid>,<uuid>
 *
 * Companion to /api/export/board-columns (which lists cards but only carries a
 * few fields). Pass the `order_id` values from that export (max 25 per call).
 * Returns what the board card / job ticket shows: category, product, materials,
 * width, height, finishing, sides, roll direction … as `spec_rows`, plus
 * owner, designer, priority, tag, due date, quantity and SKUs.
 *
 * Customer email / phone and pricing are never included.
 *
 * Auth: same secret as /api/export/board-columns (x-webhook-secret header).
 * Scope: only cards of the tenant that owns the secret.
 *
 * Response: { cards: OrderCardExport[], missing: string[] }
 */
export async function GET(request: NextRequest) {
  const secret = readSecret(request);
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

  const raw = request.nextUrl.searchParams.get("order_ids") ?? "";
  const ids = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "order_ids is required (comma-separated order_id values)" },
      { status: 400 }
    );
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `At most ${MAX_IDS} order_ids per request` },
      { status: 400 }
    );
  }
  if (ids.some((id) => !UUID_RE.test(id))) {
    return NextResponse.json(
      { error: "order_ids must be order_id UUIDs from /api/export/board-columns" },
      { status: 400 }
    );
  }

  const tenantId = webhookConfig.tenant_id;
  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();
  const tenantName = (tenant as { name?: string } | null)?.name ?? "";

  const cards: OrderCardExport[] = [];
  const missing: string[] = [];

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          // loadOrderExportData is tenant-scoped: a foreign id returns null.
          const data = await loadOrderExportData(admin, id, tenantId, tenantName);
          return { id, card: data ? orderCardExport(data) : null };
        } catch (err) {
          console.error(
            "[export/order-card] load failed:",
            id,
            err instanceof Error ? err.message : err
          );
          return { id, card: null };
        }
      })
    );
    for (const r of results) {
      if (r.card) cards.push(r.card);
      else missing.push(r.id);
    }
  }

  void touchWebhookLastUsed(admin, webhookConfig.id);

  return NextResponse.json({ cards, missing });
}
