import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { sendDieReminder } from "@/lib/die-request-send.server";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

/** POST: "Remind now" — email + text the manufacturer the quote link again. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const result = await sendDieReminder(await createClient(), {
    tenantId: ctx.tenant.id,
    requestId: id,
    actor: { id: ctx.userId, name: ctx.fullName || ctx.email },
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
