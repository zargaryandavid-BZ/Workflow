import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { performOrderMove } from "@/lib/orders/move-order.server";

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    orderId?: string;
    toColumnId?: string;
    position?: number;
    /** When true, any authenticated tenant role may move (staff follow-up buttons). */
    bypassDropRoles?: boolean;
  };

  if (!body.orderId || !body.toColumnId) {
    return NextResponse.json(
      { error: "orderId and toColumnId are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const result = await performOrderMove(supabase, {
    tenantId: ctx.tenant.id,
    tenantName: ctx.tenant.name,
    actorUserId: ctx.userId,
    actorRole: ctx.role,
    orderId: body.orderId,
    toColumnId: body.toColumnId,
    position: body.position,
    bypassDropRoles: body.bypassDropRoles,
  });
  return NextResponse.json(result.body, { status: result.status });
}
