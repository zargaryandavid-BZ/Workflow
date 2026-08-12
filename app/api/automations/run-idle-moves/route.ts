import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { runColumnIdleMovesForTenant } from "@/lib/column-idle-automation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Run idle auto-moves for the active tenant (board / admin). */
export async function POST() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const result = await runColumnIdleMovesForTenant(supabase, ctx.tenant);
  return NextResponse.json({ ok: true, ...result });
}
