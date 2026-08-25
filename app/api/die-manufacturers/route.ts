import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { mapDieManufacturerRow } from "@/lib/die-manufacturers";

export const dynamic = "force-dynamic";

/** Staff picker for Die Order (admin, account manager, pre-prod). */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("die_manufacturers")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .order("full_name", { ascending: true });

  if (error) {
    if (/die_manufacturers|schema cache|does not exist/i.test(error.message)) {
      return NextResponse.json({ manufacturers: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    manufacturers: (data ?? []).map((row) =>
      mapDieManufacturerRow(row as Record<string, unknown>)
    ),
  });
}
