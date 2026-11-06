import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  mapDieManufacturerRow,
  parseDieManufacturerBody,
} from "@/lib/die-manufacturers";
import { canViewDieOrder } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = parseDieManufacturerBody(await request.json().catch(() => ({})));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 422 });
  }

  const supabase = await createClient();
  const base = {
    full_name: parsed.full_name,
    contact_name: parsed.contact_name,
    email: parsed.email,
    phone: parsed.phone,
    updated_at: new Date().toISOString(),
  };
  const second = {
    contact_name_2: parsed.contact_name_2,
    email_2: parsed.email_2,
    phone_2: parsed.phone_2,
  };
  const run = (patch: Record<string, unknown>) =>
    supabase
      .from("die_manufacturers")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", ctx.tenant.id)
      .select("*")
      .maybeSingle();
  let warning: string | null = null;
  let { data, error } = await run({ ...base, ...second });
  // Before migration 0088 there is no second contact: save the rest.
  if (error && /contact_name_2|email_2|phone_2/i.test(error.message)) {
    ({ data, error } = await run(base));
    if (!error && (second.contact_name_2 || second.email_2 || second.phone_2)) {
      warning = "Saved, but the second contact needs migration 0088_die_manufacturer_contact_2.sql in Supabase.";
    }
  }

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
    warning,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) {
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
