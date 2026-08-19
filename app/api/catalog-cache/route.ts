import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { catalogProductCount } from "@/lib/crm-catalog-v2";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_cache")
    .select("cached_at, payload")
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "No catalog cache" }, { status: 404 });
  }

  return NextResponse.json({
    cached_at: data.cached_at,
    payload: data.payload,
    product_count: catalogProductCount(data.payload),
  });
}
