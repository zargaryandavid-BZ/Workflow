import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Teammates any staff member can @mention in notes (id + display name only). */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data: memberships, error: memError } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", ctx.tenant.id);
  if (memError) {
    return NextResponse.json({ error: memError.message }, { status: 400 });
  }

  const ids = [
    ...new Set(
      ((memberships ?? []) as { user_id: string }[])
        .map((m) => m.user_id)
        .filter(Boolean)
    ),
  ];
  if (ids.length === 0) {
    return NextResponse.json({ members: [] });
  }

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ids);
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  const members = ((profiles ?? []) as { id: string; full_name: string | null }[])
    .map((p) => ({
      id: p.id,
      fullName: (p.full_name ?? "").trim(),
    }))
    .filter((p) => p.fullName.length > 0)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return NextResponse.json({ members });
}
