import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { syncFieldOptions } from "@/lib/print-fields";

export async function POST() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  try {
    const updated = await syncFieldOptions(supabase, ctx.tenant.id);
    return NextResponse.json({ updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to sync options" },
      { status: 400 }
    );
  }
}
