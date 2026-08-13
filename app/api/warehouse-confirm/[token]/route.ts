import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmWarehouseStockByToken } from "@/lib/warehouse-stock.server";

export const runtime = "nodejs";

/**
 * Public, token-validated warehouse stock confirmation (no login).
 * The secret embedded in the token is compared constant-time before any write.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const confirmedBy = body.name?.trim() || "warehouse-sms";

  const admin = createAdminClient();
  const result = await confirmWarehouseStockByToken(admin, token, confirmedBy);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    alreadyConfirmed: result.alreadyConfirmed,
  });
}
