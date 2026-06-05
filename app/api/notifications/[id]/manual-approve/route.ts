import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { onApprovalResult } from "@/lib/automation";
import type { JobNotification } from "@/lib/types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data: notification } = await supabase
    .from("job_notifications")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!notification || notification.tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const note = notification as JobNotification;
  if (note.type !== "customer_approval") {
    return NextResponse.json(
      { error: "Only approval requests can be marked here." },
      { status: 400 }
    );
  }
  if (note.status === "responded") {
    return NextResponse.json(
      { error: "This approval has already been decided." },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabase
    .from("job_notifications")
    .update({
      status: "responded",
      customer_response: "approved",
      customer_note: "Approved manually by staff",
      responded_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  await onApprovalResult(supabase, {
    tenantId: ctx.tenant.id,
    orderId: note.order_id,
    result: "approved",
  });

  return NextResponse.json({ ok: true });
}
