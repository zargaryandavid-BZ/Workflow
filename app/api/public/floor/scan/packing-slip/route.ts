import { NextResponse } from "next/server";
import {
  generateFloorPackingSlip,
  type PackingSlipBoxInput,
} from "@/lib/packing-slip-generate";
import { resolveFloorTenant } from "@/lib/kiosk-token";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Public Sender packing slip — no staff session. */
export async function POST(request: Request) {
  const floor = await resolveFloorTenant();
  if (!floor) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
    part?: number;
    totalParts?: number;
    layout?: "multiple" | "one_per_slip";
    pageSize?: "letter" | "4x6";
    boxes?: PackingSlipBoxInput[];
  };
  const orderId = body.order_id?.trim() ?? "";
  if (!orderId) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  }

  const { data: tenant } = await floor.supabase
    .from("tenants")
    .select("name")
    .eq("id", floor.tenantId)
    .maybeSingle();

  const result = await generateFloorPackingSlip(
    floor.supabase,
    orderId,
    floor.tenantId,
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
