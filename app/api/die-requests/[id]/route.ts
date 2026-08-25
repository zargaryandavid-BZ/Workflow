import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { isValidEmail } from "@/lib/die-manufacturers";
import {
  collectDieUploadFiles,
  parseDieRequestFiles,
  type DieRequestFile,
} from "@/lib/die-request";
import {
  primaryDieFileFields,
  storeDieRequestFiles,
} from "@/lib/die-request-upload";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const form = await request.formData();
  const manufacturerId = String(form.get("manufacturerId") ?? "").trim();
  const comment = String(form.get("comment") ?? "").trim() || null;
  const widthRaw = String(form.get("width") ?? "").trim();
  const heightRaw = String(form.get("height") ?? "").trim();
  const requiredDate = String(form.get("requiredDate") ?? "").trim();
  const allowOwnDate =
    form.get("allowOwnDate") === "true" || form.get("allowOwnDate") === "on";
  const incomingFiles = collectDieUploadFiles(form);

  if (!manufacturerId || !requiredDate) {
    return NextResponse.json(
      { error: "Die manufacturer and required date are required." },
      { status: 422 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requiredDate)) {
    return NextResponse.json(
      { error: "Required date must be YYYY-MM-DD." },
      { status: 422 }
    );
  }

  const width = widthRaw ? Number(widthRaw) : null;
  const height = heightRaw ? Number(heightRaw) : null;
  if (
    (widthRaw && (!Number.isFinite(width) || (width ?? 0) <= 0)) ||
    (heightRaw && (!Number.isFinite(height) || (height ?? 0) <= 0))
  ) {
    return NextResponse.json(
      { error: "Width and height must be positive numbers." },
      { status: 422 }
    );
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("die_requests")
    .select("id, tenant_id, order_id, status, file_path, file_name, file_mime, files")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (existing.status === "ordered") {
    return NextResponse.json(
      { error: "This die is already ordered and cannot be edited." },
      { status: 409 }
    );
  }

  const { data: manufacturer } = await supabase
    .from("die_manufacturers")
    .select("id, email")
    .eq("id", manufacturerId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!manufacturer?.email) {
    return NextResponse.json(
      { error: "Die manufacturer not found." },
      { status: 404 }
    );
  }
  const toEmail = String(manufacturer.email).trim();
  if (!isValidEmail(toEmail)) {
    return NextResponse.json(
      { error: "That manufacturer does not have a valid email." },
      { status: 422 }
    );
  }

  const currentFiles: DieRequestFile[] = parseDieRequestFiles(
    (existing as { files?: unknown }).files
  );
  if (
    currentFiles.length === 0 &&
    (existing as { file_path?: string | null }).file_path
  ) {
    currentFiles.push({
      path: String((existing as { file_path: string }).file_path),
      name: String((existing as { file_name?: string | null }).file_name ?? "file"),
      mime: (existing as { file_mime?: string | null }).file_mime
        ? String((existing as { file_mime: string }).file_mime)
        : null,
    });
  }

  const patch: Record<string, unknown> = {
    width,
    height,
    required_date: requiredDate,
    allow_own_date: allowOwnDate,
    manufacturer_id: manufacturerId,
    to_email: toEmail,
    comment,
  };

  if (incomingFiles.length > 0) {
    const stored = await storeDieRequestFiles(
      supabase,
      ctx.tenant.id,
      existing.order_id,
      incomingFiles,
      currentFiles
    );
    if ("error" in stored) {
      return NextResponse.json({ error: stored.error }, { status: 422 });
    }
    const primary = primaryDieFileFields(stored.files);
    patch.files = stored.files;
    patch.file_path = primary.file_path;
    patch.file_name = primary.file_name;
    patch.file_mime = primary.file_mime;
  }

  const { error } = await supabase
    .from("die_requests")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) {
    return NextResponse.json(
      {
        error: /allow_own_date/i.test(error.message)
          ? "Run migration 0090_die_allow_own_date.sql in Supabase, then try again."
          : /files/i.test(error.message)
          ? "Run migration 0087_die_request_files.sql in Supabase, then try again."
          : error.message,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
