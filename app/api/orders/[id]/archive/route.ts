import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity } from "@/lib/automation";
import { buildOrderArchiveZip } from "@/lib/order-archive";

export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const result = await buildOrderArchiveZip(supabase, {
    tenantId: ctx.tenant.id,
    orderId: id,
  });

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId: id,
    actor: ctx.userId,
    action: "archived_downloaded",
    metadata: {
      fileName: result.fileName,
      failures: result.failures.length,
    },
  });

  return new NextResponse(new Uint8Array(result.zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${result.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
      "X-Archive-Failures": String(result.failures.length),
    },
  });
}
