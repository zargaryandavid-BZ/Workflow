import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runMissingInfoDriveSweepForTenant } from "@/lib/missing-info-drive-sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

/**
 * Cron: files a customer drops into an order's Drive folder (broker portal
 * uploads) reach the card's own item folder, and a Missing Info card with new
 * customer files goes back like the missing-info link sends it.
 * Optional ?order=<id>,<id> limits the run to those cards.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orderIds = (req.nextUrl.searchParams.get("order") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const admin = createAdminClient();
  const { data: tenants, error } = await admin.from("tenants").select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const t of (tenants ?? []) as { id: string }[]) {
    try {
      results.push(
        await runMissingInfoDriveSweepForTenant(admin, t.id, {
          orderIds: orderIds.length ? orderIds : undefined,
        })
      );
    } catch (err) {
      console.error("[cron/missing-info-drive]", t.id, err);
      results.push({
        tenantId: t.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return NextResponse.json({ ok: true, results });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
