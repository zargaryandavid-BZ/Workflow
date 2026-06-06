import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { importSystemConfigForTenant } from "@/lib/system-config.server";
import { assertSystemConfig } from "@/lib/validate-system-config";

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const raw = await request.json().catch(() => null);
  let config;
  try {
    config = assertSystemConfig(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid configuration";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const supabase = await createClient();
  const result = await importSystemConfigForTenant(
    supabase,
    config,
    ctx.tenant.id
  );

  return NextResponse.json(result, {
    status: result.success ? 200 : 207,
  });
}
