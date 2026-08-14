import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { isSmsConfigured, sendSms, normalizeSmsPhone } from "@/lib/sms";
import { logActivity } from "@/lib/automation";

/**
 * Nudge the person working an order: text the assigned designer (or owner) a
 * short reminder that the job is waiting on them. Reuses profile phones.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSmsConfigured()) {
    return NextResponse.json(
      { error: "SMS is not configured." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    target?: "designer" | "owner";
  };
  const target = body.target === "owner" ? "owner" : "designer";

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, tenant_id, title, specs, column_id, created_by")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const specs = order.specs as Record<string, unknown> | null;
  const designerId =
    typeof specs?.designer_id === "string" ? specs.designer_id : null;
  const profileId =
    target === "owner"
      ? (order.created_by as string | null)
      : (designerId ?? (order.created_by as string | null));
  if (!profileId) {
    return NextResponse.json(
      { error: "No one is assigned to nudge on this order." },
      { status: 422 }
    );
  }

  const { data: person } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", profileId)
    .maybeSingle();
  const phone = (person as { phone?: string | null } | null)?.phone?.trim();
  if (!phone) {
    return NextResponse.json(
      { error: "That person has no phone number on file." },
      { status: 422 }
    );
  }

  const { data: sender } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", ctx.userId)
    .maybeSingle();
  const senderName =
    (sender as { full_name?: string | null } | null)?.full_name?.trim() ||
    "A teammate";

  let columnName = "the board";
  if (order.column_id) {
    const { data: col } = await supabase
      .from("board_columns")
      .select("name")
      .eq("id", order.column_id as string)
      .maybeSingle();
    columnName = (col as { name?: string } | null)?.name ?? columnName;
  }

  const message = `${senderName} nudged you — order ${order.title} is in ${columnName}. Please take a look.`;
  const result = await sendSms({ to: normalizeSmsPhone(phone), body: message });
  if (!result.sent) {
    return NextResponse.json(
      { error: result.error ?? "Failed to send nudge." },
      { status: 502 }
    );
  }

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    actor: ctx.userId,
    action: "nudged",
    metadata: { target, to: normalizeSmsPhone(phone) },
  });

  return NextResponse.json({
    ok: true,
    nudged: (person as { full_name?: string | null } | null)?.full_name ?? null,
  });
}
