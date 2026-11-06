import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getTenantContext } from "@/lib/auth";
import { peekNextDieCode } from "@/lib/dies.server";
import { appOrigin } from "@/lib/app-url";
import { dieQrPath } from "@/lib/dies";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET: the Template ID "+ Add Die" will create, with its QR code, so the popup
 * can show both before saving. Saving uses the same rule; if someone else
 * adds a die first, the save gets the next number (the popup says so).
 */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await peekNextDieCode(await createClient(), ctx.tenant.id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const qrDataUrl = await QRCode.toDataURL(`${appOrigin()}${dieQrPath(result.code)}`, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: 256,
  });
  return NextResponse.json(
    { code: result.code, qrDataUrl },
    { headers: { "Cache-Control": "no-store" } }
  );
}
