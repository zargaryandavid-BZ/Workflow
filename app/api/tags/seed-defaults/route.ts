import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { seedDefaultTags } from "@/lib/tags";

export async function POST() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  try {
    const added = await seedDefaultTags(supabase, ctx.tenant.id);
    return NextResponse.json({ added });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to seed tags" },
      { status: 400 }
    );
  }
}
