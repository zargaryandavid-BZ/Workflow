import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizeEmergencyBalance } from "@/lib/emergency-balance";

export async function PATCH(req: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin")
    return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: cols } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", ctx.tenant.id);

  const columnRefs = (cols ?? []).map((c: { id: string; name: string }) => ({
    id: c.id,
    name: c.name,
  }));

  const merged = normalizeEmergencyBalance(body, columnRefs);

  const { error } = await supabase
    .from("tenants")
    .update({ emergency_balance: merged })
    .eq("id", ctx.tenant.id);

  if (error) {
    if (/emergency_balance|column .* does not exist/i.test(error.message)) {
      return NextResponse.json(
        {
          error:
            "Database migration required: run 0072_emergency_balance.sql (or supabase db push).",
          migrationRequired: true,
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, emergency_balance: merged });
}
