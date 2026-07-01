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
  if (!Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
    return NextResponse.json({ error: "orderedIds required" }, { status: 400 });
  }

  const supabase = await createClient();
  await Promise.all(
    body.orderedIds.map((id, index) =>
      supabase
        .from("tags")
        .update({ position: index })
        .eq("id", id)
        .eq("tenant_id", ctx.tenant.id)
    )
  );

  return NextResponse.json({ ok: true });
}
