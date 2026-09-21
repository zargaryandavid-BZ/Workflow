import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Toggle the Priority List "Done" checkbox. Any authenticated staff member
 * may call this (not admin-gated) — the whole point is that whoever finishes
 * the job can check it off without asking an admin.
 */
export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    orderId?: string;
    done?: boolean;
  };
  if (!body.orderId || typeof body.done !== "boolean") {
    return NextResponse.json(
      { error: "orderId and done are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("id", body.orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("orders")
    .update({
      daily_priority_done: body.done,
      daily_priority_done_at: body.done ? new Date().toISOString() : null,
    })
    .eq("id", body.orderId)
    .eq("tenant_id", tenantId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
