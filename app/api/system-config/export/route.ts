import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { exportSystemConfigForTenant } from "@/lib/system-config.server";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const supabase = await createClient();
  const config = await exportSystemConfigForTenant(
    supabase,
    ctx.tenant.id,
    ctx.tenant.name
  );

  return NextResponse.json(config);
}
