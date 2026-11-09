import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";

function tableMissing(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    (msg.includes("user_notifications") && msg.includes("does not exist"))
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { unread?: unknown };
  const markUnread = body.unread === true;
  // Read / unread is per person: everyone (admins too) only changes their OWN
  // notifications. Admins can still SEE the team's notifications in the inbox,
  // but opening one no longer clears it for the teammate it was meant for.
  const supabase = await createClient();
  const query = supabase
    .from("user_notifications")
    .update({ read_at: markUnread ? null : new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.userId);

  const { error } = await query;

  if (error) {
    if (tableMissing(error)) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
