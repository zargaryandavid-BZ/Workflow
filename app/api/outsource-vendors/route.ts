import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewDieOrder } from "@/lib/permissions";
import { isValidEmail } from "@/lib/die-manufacturers";
import { PO_MIGRATION_HINT, poMigrationMissing } from "@/lib/purchase-order.server";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outsource_vendors")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .order("name");
  if (error) {
    return NextResponse.json(
      { error: poMigrationMissing(error.message) ? PO_MIGRATION_HINT : error.message },
      { status: 400 }
    );
  }
  return NextResponse.json({ vendors: data ?? [] });
}

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  if (!name || !isValidEmail(email)) {
    return NextResponse.json({ error: "Vendor name and a valid email are required." }, { status: 422 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outsource_vendors")
    .insert({
      tenant_id: ctx.tenant.id,
      name,
      email,
      contact_name: String(body.contact_name ?? "").trim() || null,
      phone: String(body.phone ?? "").trim() || null,
      notes: String(body.notes ?? "").trim() || null,
    })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json(
      { error: poMigrationMissing(error.message) ? PO_MIGRATION_HINT : error.message },
      { status: 400 }
    );
  }
  return NextResponse.json({ vendor: data });
}
