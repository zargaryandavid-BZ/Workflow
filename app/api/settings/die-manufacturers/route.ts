import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  mapDieManufacturerRow,
  parseDieManufacturerBody,
} from "@/lib/die-manufacturers";
import { canViewDieOrder } from "@/lib/permissions";

export const dynamic = "force-dynamic";

function tableMissing(message: string): boolean {
  return /die_manufacturers|schema cache|does not exist/i.test(message);
}

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("die_manufacturers")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .order("full_name", { ascending: true });

  if (error) {
    if (tableMissing(error.message)) {
      return NextResponse.json({ manufacturers: [], migrationRequired: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    manufacturers: (data ?? []).map((row) =>
      mapDieManufacturerRow(row as Record<string, unknown>)
    ),
  });
}

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const parsed = parseDieManufacturerBody(await request.json().catch(() => ({})));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 422 });
  }

  const supabase = await createClient();
  const base = {
    tenant_id: ctx.tenant.id,
    full_name: parsed.full_name,
    contact_name: parsed.contact_name,
    email: parsed.email,
    phone: parsed.phone,
  };
  const second = {
    contact_name_2: parsed.contact_name_2,
    email_2: parsed.email_2,
    phone_2: parsed.phone_2,
  };
  let warning: string | null = null;
  let { data, error } = await supabase
    .from("die_manufacturers")
    .insert({ ...base, ...second })
    .select("*")
    .single();
  // Before migration 0088 there is no second contact: save the rest.
  if (error && /contact_name_2|email_2|phone_2/i.test(error.message)) {
    ({ data, error } = await supabase.from("die_manufacturers").insert(base).select("*").single());
    if (!error && (second.contact_name_2 || second.email_2 || second.phone_2)) {
      warning = "Saved, but the second contact needs migration 0088_die_manufacturer_contact_2.sql in Supabase.";
    }
  }

  if (error || !data) {
    if (error && tableMissing(error.message)) {
      return NextResponse.json(
        {
          error: /contact_name/i.test(error.message)
            ? "Run migration 0086_die_manufacturer_contact_name.sql in Supabase, then try again."
            : "Run migration 0085_die_manufacturers.sql in Supabase, then try again.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error?.message ?? "Failed to save manufacturer" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    manufacturer: mapDieManufacturerRow(data as Record<string, unknown>),
    warning,
  });
}
