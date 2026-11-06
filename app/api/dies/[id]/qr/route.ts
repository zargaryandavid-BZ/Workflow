import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { getDie } from "@/lib/dies.server";
import { orderNumberQrPng } from "@/lib/order-qr";
import { appOrigin } from "@/lib/app-url";
import { dieQrPath } from "@/lib/dies";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** GET: PNG QR code of the die's Template ID (scans as e.g. "DIE-00001"). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Any signed-in staff member: the die page (opened by scanning) shows it.
  const { id } = await params;
  const die = await getDie(await createClient(), ctx.tenant.id, id);
  if (!die) return NextResponse.json({ error: "Die not found" }, { status: 404 });
  // Scanning opens the die page (Use / Return, history).
  const png = await orderNumberQrPng(`${appOrigin()}${dieQrPath(die.template_code)}`);
  if (!png) return NextResponse.json({ error: "No code" }, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
      ...(download
        ? { "Content-Disposition": `attachment; filename="${die.template_code}.png"` }
        : {}),
    },
  });
}
