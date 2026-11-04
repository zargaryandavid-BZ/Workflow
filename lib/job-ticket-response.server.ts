import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateJobTicketPdfBuffer } from "@/lib/job-ticket-generate";

/**
 * Job ticket PDF for any order of the tenant (no "still in production" gate),
 * used by Scan → Sent history where orders have already left production.
 */
export async function jobTicketPdfResponse(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string | null
): Promise<NextResponse> {
  const id = orderId?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  }
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();
  const result = await generateJobTicketPdfBuffer(
    supabase,
    id,
    tenantId,
    (tenant as { name?: string } | null)?.name ?? ""
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const safeName = result.orderNumber.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="job-ticket-${safeName}.pdf"`,
    },
  });
}
