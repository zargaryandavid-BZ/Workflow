import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: "seen" | "remove";
  };
  if (body.action !== "seen" && body.action !== "remove") {
    return NextResponse.json(
      { error: "action must be 'seen' or 'remove'" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const patch =
    body.action === "seen"
      ? { shipping_status_seen_at: now }
      : {
          shipping_status_seen_at: now,
          shipping_status_removed_at: now,
          shipping_status_removed_reason: "manual",
        };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipping_requests")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "client_responded")
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
