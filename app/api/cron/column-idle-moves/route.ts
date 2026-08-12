import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runColumnIdleMovesForTenant } from "@/lib/column-idle-automation";
import type { Tenant } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  const q = req.nextUrl.searchParams.get("secret");
  return q === secret;
}

/**
 * Cron entrypoint: process on_column_idle rules for every tenant.
 * Auth: Authorization: Bearer $CRON_SECRET (or ?secret=).
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, name, warning_working_days");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];
  for (const t of (tenants ?? []) as Pick<
    Tenant,
    "id" | "name" | "warning_working_days"
  >[]) {
    try {
      results.push(await runColumnIdleMovesForTenant(admin, t));
    } catch (err) {
      console.error("[cron/column-idle-moves]", t.id, err);
      results.push({
        tenantId: t.id,
        moved: 0,
        checked: 0,
        rules: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const moved = results.reduce((n, r) => n + (r.moved ?? 0), 0);
  return NextResponse.json({ ok: true, moved, results });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
