import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { regenerateWebhookSecret } from "@/lib/webhook-config";

export async function POST() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  try {
    const config = await regenerateWebhookSecret(supabase, ctx.tenant.id);
    return NextResponse.json({ config });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to regenerate secret";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
