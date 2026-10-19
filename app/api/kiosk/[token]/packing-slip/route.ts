import { NextResponse } from "next/server";
import { generateFloorPackingSlip } from "@/lib/packing-slip-generate";
import { resolveKioskTenant } from "@/lib/kiosk-token";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Kiosk Sender packing slip. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params;
  const kiosk = await resolveKioskTenant(rawToken);
  if (!kiosk) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
    part?: number;
    totalParts?: number;
    layout?: "multiple" | "one_per_slip";
    pageSize?: "letter" | "4x6";
    boxes?: { boxNumber?: number; lines?: { skuId?: string; qty?: number }[] }[];
  };
  const orderId = body.order_id?.trim() ?? "";
  if (!orderId) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  }

  const { data: tenant } = await kiosk.supabase
    .from("tenants")
    .select("name")
    .eq("id", kiosk.tenantId)
    .maybeSingle();

  const result = await generateFloorPackingSlip(
    kiosk.supabase,
    orderId,
    kiosk.tenantId,
    (tenant as { name?: string } | null)?.name ?? "",
    body
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const safeName = result.orderNumber.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="packing-slip-${safeName}-${result.part}of${result.totalParts}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
