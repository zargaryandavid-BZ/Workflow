import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import type { UserNotification } from "@/lib/user-notifications";

const SELECT =
  "id, tenant_id, user_id, type, title, body, order_id, actor_id, actor_name, read_at, created_at";

function tableMissing(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    (msg.includes("user_notifications") && msg.includes("does not exist"))
  );
}

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_notifications")
    .select(SELECT)
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    if (tableMissing(error)) {
      return NextResponse.json({ notifications: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    notifications: (data ?? []) as UserNotification[],
  });
}

export async function PATCH() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.userId)
    .is("read_at", null);

  if (error) {
    if (tableMissing(error)) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
