import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDesignerStaleReassignForTenant } from "@/lib/designer-stale-reassign";

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
 * Cron entrypoint: transfer jobs that have sat too long with one pool designer
 * to the next least-busy pool designer, per each tenant's Settings → Designers.
 * No-ops for tenants that haven't enabled it or set a stale threshold.
 * Auth: Authorization: Bearer $CRON_SECRET (or ?secret=). Schedule in vercel.json.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: tenants, error } = await admin.from("tenants").select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];
  for (const t of (tenants ?? []) as { id: string }[]) {
    try {
      results.push(await runDesignerStaleReassignForTenant(admin, t));
    } catch (err) {
      console.error("[cron/designer-stale-reassign]", t.id, err);
      results.push({
        tenantId: t.id,
        checked: 0,
        moved: 0,
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
