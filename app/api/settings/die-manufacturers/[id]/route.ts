import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  mapDieManufacturerRow,
  parseDieManufacturerBody,
} from "@/lib/die-manufacturers";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = parseDieManufacturerBody(await request.json().catch(() => ({})));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 422 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("die_manufacturers")
    .update({
      full_name: parsed.full_name,
      contact_name: parsed.contact_name,
      email: parsed.email,
      phone: parsed.phone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        error: /contact_name/i.test(error.message)
          ? "Run migration 0086_die_manufacturer_contact_name.sql in Supabase, then try again."
          : error.message,
      },
      { status: 400 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Manufacturer not found" }, { status: 404 });
  }

  return NextResponse.json({
    manufacturer: mapDieManufacturerRow(data as Record<string, unknown>),
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase
    .from("die_manufacturers")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
