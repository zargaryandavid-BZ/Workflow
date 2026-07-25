import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { persistColumnOrdersAsArchives } from "@/lib/order-archive";
import type { StoredArchiveRow } from "@/lib/order-archive-types";

export const maxDuration = 300;

export type ColumnArchiveRow = StoredArchiveRow;

/** List stored archives for this tenant (admin). */
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
    .limit(200);

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

  return NextResponse.json({ archives: (data ?? []) as StoredArchiveRow[] });
}

/** Archive every order in a column into Supabase Storage (one ZIP per order). */
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

  const result = await persistColumnOrdersAsArchives(supabase, {
    tenantId,
    columnId: body.columnId,
    columnName,
    createdBy: ctx.userId,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    archives: result.archives,
    archivedCount: result.archives.length,
    failedCount: result.failed.length,
    failed: result.failed,
    skippedOverLimit: result.skippedOverLimit,
  });
}
