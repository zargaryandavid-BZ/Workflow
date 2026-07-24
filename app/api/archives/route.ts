import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/auth";
import {
  ORDER_ARCHIVES_BUCKET,
  buildColumnArchiveZip,
} from "@/lib/order-archive";

export const maxDuration = 300;

export interface ColumnArchiveRow {
  id: string;
  tenant_id: string;
  column_id: string | null;
  column_name: string;
  storage_path: string | null;
  file_name: string | null;
  file_size: number | null;
  order_count: number;
  failure_count: number;
  status: "pending" | "ready" | "failed";
  error: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

/** List stored column archives for this tenant (admin). */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("column_archives")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    if (error.message.includes("column_archives")) {
      return NextResponse.json(
        {
          error:
            "Archive storage is not set up yet. Apply migration 0062_column_archives.sql.",
          archives: [],
        },
        { status: 200 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ archives: (data ?? []) as ColumnArchiveRow[] });
}

/** Archive all orders in a column into Supabase Storage. */
export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    columnId?: string;
  };
  if (!body.columnId) {
    return NextResponse.json({ error: "columnId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: column, error: colError } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("id", body.columnId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (colError || !column) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  const columnName = (column as { id: string; name: string }).name;

  const { data: pending, error: insertError } = await supabase
    .from("column_archives")
    .insert({
      tenant_id: tenantId,
      column_id: body.columnId,
      column_name: columnName,
      status: "pending",
      created_by: ctx.userId,
    })
    .select("*")
    .single();

  if (insertError || !pending) {
    return NextResponse.json(
      {
        error:
          insertError?.message?.includes("column_archives")
            ? "Archive storage is not set up yet. Apply migration 0062_column_archives.sql."
            : (insertError?.message ?? "Failed to start archive"),
      },
      { status: 400 }
    );
  }

  const archiveId = (pending as ColumnArchiveRow).id;

  try {
    const built = await buildColumnArchiveZip(supabase, {
      tenantId,
      columnId: body.columnId,
      columnName,
    });

    if ("error" in built) {
      await supabase
        .from("column_archives")
        .update({
          status: "failed",
          error: built.error,
          completed_at: new Date().toISOString(),
        })
        .eq("id", archiveId);
      return NextResponse.json({ error: built.error }, { status: built.status });
    }

    const storagePath = `${tenantId}/${archiveId}/${built.fileName}`;
    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage
      .from(ORDER_ARCHIVES_BUCKET)
      .upload(storagePath, built.zip, {
        contentType: "application/zip",
        upsert: false,
      });

    if (uploadError) {
      await supabase
        .from("column_archives")
        .update({
          status: "failed",
          error: uploadError.message,
          order_count: built.orderCount,
          failure_count: built.failures.length,
          completed_at: new Date().toISOString(),
        })
        .eq("id", archiveId);
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const { data: ready, error: updateError } = await supabase
      .from("column_archives")
      .update({
        status: "ready",
        storage_path: storagePath,
        file_name: built.fileName,
        file_size: built.zip.byteLength,
        order_count: built.orderCount,
        failure_count: built.failures.length,
        completed_at: new Date().toISOString(),
        error:
          built.skippedOverLimit > 0
            ? `Archived first ${built.orderCount} orders; ${built.skippedOverLimit} skipped (limit).`
            : null,
      })
      .eq("id", archiveId)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      archive: ready as ColumnArchiveRow,
      skippedOverLimit: built.skippedOverLimit,
      failureCount: built.failures.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Archive failed";
    await supabase
      .from("column_archives")
      .update({
        status: "failed",
        error: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", archiveId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
