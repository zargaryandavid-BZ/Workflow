import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/auth";
import { ORDER_ARCHIVES_BUCKET } from "@/lib/order-archive";
import type { ColumnArchiveRow } from "@/app/api/archives/route";

/** Download a stored column archive ZIP. */
export async function GET(
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
  const { data, error } = await supabase
    .from("column_archives")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Archive not found" }, { status: 404 });
  }

  const row = data as ColumnArchiveRow;
  if (row.status !== "ready" || !row.storage_path || !row.file_name) {
    return NextResponse.json(
      { error: row.error ?? "Archive is not ready" },
      { status: 409 }
    );
  }

  const admin = createAdminClient();
  const { data: file, error: dlError } = await admin.storage
    .from(ORDER_ARCHIVES_BUCKET)
    .download(row.storage_path);

  if (dlError || !file) {
    return NextResponse.json(
      { error: dlError?.message ?? "Failed to download archive file" },
      { status: 500 }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${row.file_name.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Delete a stored column archive (DB row + Storage object). */
export async function DELETE(
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
  const { data, error } = await supabase
    .from("column_archives")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Archive not found" }, { status: 404 });
  }

  const row = data as ColumnArchiveRow;
  if (row.storage_path) {
    const admin = createAdminClient();
    await admin.storage.from(ORDER_ARCHIVES_BUCKET).remove([row.storage_path]);
  }

  const { error: delError } = await supabase
    .from("column_archives")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (delError) {
    return NextResponse.json({ error: delError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
