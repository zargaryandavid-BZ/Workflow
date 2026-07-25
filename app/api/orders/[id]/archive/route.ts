import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity } from "@/lib/automation";
import {
  buildOrderArchiveZip,
  persistOrderArchive,
} from "@/lib/order-archive";

export const maxDuration = 60;

/** Download a ZIP of this order to the browser (not stored). */
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

/** Archive this order into Supabase Storage (appears under Stored archives). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, title, column_id")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .is("removed_at", null)
    .maybeSingle();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const row = order as { id: string; title: string; column_id: string };
  let columnName = "Unknown column";
  const { data: column } = await supabase
    .from("board_columns")
    .select("name")
    .eq("id", row.column_id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (column && typeof (column as { name?: string }).name === "string") {
    columnName = (column as { name: string }).name;
  }

  const result = await persistOrderArchive(supabase, {
    tenantId: ctx.tenant.id,
    orderId: id,
    columnId: row.column_id,
    columnName,
    orderTitle: row.title,
    createdBy: ctx.userId,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId: id,
    actor: ctx.userId,
    action: "archived_to_storage",
    metadata: {
      archiveId: result.archive.id,
      fileName: result.archive.file_name,
      failures: result.failures.length,
    },
  });

  return NextResponse.json({
    archive: result.archive,
    failureCount: result.failures.length,
  });
}
