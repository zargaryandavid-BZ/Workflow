import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { onApprovalResult } from "@/lib/automation";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    decision?: "approved" | "rejected";
    comment?: string;
  };

  if (!body.token || !body.decision) {
    return NextResponse.json(
      { error: "token and decision are required" },
      { status: 400 }
    );
  }
  if (body.decision !== "approved" && body.decision !== "rejected") {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }

  // Anonymous customer: use the service-role client but gate strictly on the
  // unguessable token.
  const admin = createAdminClient();

  const { data: approval } = await admin
    .from("approvals")
    .select("*")
    .eq("token", body.token)
    .maybeSingle();

  if (!approval) {
    return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  }
  if (approval.status !== "pending") {
    return NextResponse.json(
      { error: "This request has already been decided." },
      { status: 409 }
    );
  }

  const comment = body.comment?.trim() || null;
  if (body.decision === "rejected" && !comment) {
    return NextResponse.json(
      { error: "Please tell us why the proof was not approved." },
      { status: 400 }
    );
  }

  const { error } = await admin
    .from("approvals")
    .update({
      status: body.decision,
      comment,
      decided_at: new Date().toISOString(),
    })
    .eq("id", approval.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Apply automation (move the card) and log activity.
  await onApprovalResult(admin, {
    tenantId: approval.tenant_id,
    orderId: approval.order_id,
    result: body.decision,
  });

  return NextResponse.json({ ok: true, status: body.decision });
}
