import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

/** GET — manufacturer replies waiting for staff confirm (`status = quoted`). */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ count: 0 });
  }

  const supabase = await createClient();
  const { count, error } = await supabase
    .from("die_requests")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "quoted");

  if (error) {
    if (/die_requests|schema cache|does not exist/i.test(error.message)) {
      return NextResponse.json({ count: 0 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ count: count ?? 0 });
}
