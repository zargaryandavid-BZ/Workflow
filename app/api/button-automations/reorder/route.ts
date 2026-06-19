import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    orderedIds?: string[];
  };
  if (!body.orderedIds?.length) {
    return NextResponse.json({ error: "orderedIds required" }, { status: 422 });
  }

  const supabase = await createClient();
  const updates = body.orderedIds.map((id, position) =>
    supabase
      .from("button_automations")
      .update({ position })
      .eq("id", id)
      .eq("tenant_id", ctx.tenant.id)
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
