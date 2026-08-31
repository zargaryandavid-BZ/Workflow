import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

async function withRecipientNames(
  rows: UserNotification[]
): Promise<UserNotification[]> {
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  if (ids.length === 0) return rows;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);
    const nameById = new Map(
      ((data ?? []) as { id: string; full_name: string | null }[]).map((p) => [
        p.id,
        p.full_name?.trim() || "Unnamed",
      ])
    );
    return rows.map((r) => ({
      ...r,
      recipient_name: nameById.get(r.user_id) ?? "Unnamed",
    }));
  } catch {
    return rows;
  }
}

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = ctx.role === "admin";
  const supabase = isAdmin ? createAdminClient() : await createClient();
  let query = supabase
    .from("user_notifications")
    .select(SELECT)
    .eq("tenant_id", ctx.tenant.id)
    .order("created_at", { ascending: false })
    .limit(isAdmin ? 80 : 40);

  if (!isAdmin) {
    query = query.eq("user_id", ctx.userId);
  }

  const { data, error } = await query;

  if (error) {
    if (tableMissing(error)) {
      return NextResponse.json({ notifications: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as UserNotification[];
  const notifications = isAdmin ? await withRecipientNames(rows) : rows;

  return NextResponse.json({ notifications });
}

export async function PATCH() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = ctx.role === "admin";
  const supabase = isAdmin ? createAdminClient() : await createClient();
  let query = supabase
    .from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenant.id)
    .is("read_at", null);

  if (!isAdmin) {
    query = query.eq("user_id", ctx.userId);
  }

  const { error } = await query;

  if (error) {
    if (tableMissing(error)) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
