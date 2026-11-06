import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { isValidEmail } from "@/lib/die-manufacturers";
import {
  DIE_PAST_DATE_ERROR,
  isDieDatePast,
  collectDieUploadFiles,
  parseDieRequestFiles,
  parseOptionalDieDim,
  type DieRequestFile,
} from "@/lib/die-request";
import {
  primaryDieFileFields,
  storeDieRequestFiles,
} from "@/lib/die-request-upload";
import { sendDieQuoteRequest } from "@/lib/die-request-send.server";

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
  const productName = String(form.get("productName") ?? "").trim() || null;
  const widthRaw = String(form.get("width") ?? "").trim();
  const heightRaw = String(form.get("height") ?? "").trim();
  const depthRaw = String(form.get("depth") ?? "").trim();
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

  const widthParsed = parseOptionalDieDim(widthRaw);
  const heightParsed = parseOptionalDieDim(heightRaw);
  const depthParsed = parseOptionalDieDim(depthRaw);
  if (!widthParsed.ok || !heightParsed.ok || !depthParsed.ok) {
    return NextResponse.json(
      { error: "Width, height, and depth must be positive numbers." },
      { status: 422 }
    );
  }
  const width = widthParsed.value;
  const height = heightParsed.value;
  const depth = depthParsed.value;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("die_requests")
    .select("id, tenant_id, order_id, status, required_date, manufacturer_id, file_path, file_name, file_mime, files, order:orders(title)")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (existing.status === "ordered" || existing.status === "received") {
    return NextResponse.json(
      { error: "This die is already ordered and cannot be edited." },
      { status: 409 }
    );
  }  // Only a changed date must be today or later, so an older request can
  // still be edited (files, comment) without moving its date.
  if (
    requiredDate !== String(existing.required_date ?? "").slice(0, 10) &&
    isDieDatePast(requiredDate)
  ) {
    return NextResponse.json(
      { error: `Required date is in the past. ${DIE_PAST_DATE_ERROR}` },
      { status: 422 }
    );
  }


  const { data: manufacturer } = await supabase
    .from("die_manufacturers")
    .select("*")
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

  // Moved to a different manufacturer: the new one must get the link, and
  // the old one's link / quote no longer counts (new token, back to Waiting).
  const manufacturerChanged =
    String((existing as { manufacturer_id?: string | null }).manufacturer_id ?? "") !==
    manufacturerId;
  const newToken = manufacturerChanged ? crypto.randomUUID() : null;

  const patch: Record<string, unknown> = {
    width,
    height,
    depth,
    product_name: productName,
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

  if (newToken) {
    Object.assign(patch, {
      token: newToken,
      status: "sent",
      quoted_price: null,
      time_estimate: null,
      confirmed_due_date: null,
      client_note: null,
      quoted_at: null,
      sent_at: new Date().toISOString(),
    });
  }

  const { error } = await supabase
    .from("die_requests")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .in("status", ["sent", "quoted"]);

  if (error) {
    return NextResponse.json(
      {
        error: /allow_own_date/i.test(error.message)
          ? "Run migration 0090_die_allow_own_date.sql in Supabase, then try again."
          : /depth|product_name/i.test(error.message)
          ? "Run migration 0091_die_request_depth_product.sql in Supabase, then try again."
          : /files/i.test(error.message)
          ? "Run migration 0087_die_request_files.sql in Supabase, then try again."
          : error.message,
      },
      { status: 400 }
    );
  }

  if (newToken) {
    const order = (existing as { order?: { title?: string } | { title?: string }[] | null }).order;
    const orderTitle = (Array.isArray(order) ? order[0]?.title : order?.title) ?? "Order";
    const notify = await sendDieQuoteRequest(supabase, {
      tenantId: ctx.tenant.id,
      token: newToken,
      orderTitle,
      manufacturer: manufacturer as Record<string, unknown>,
      productName,
      width,
      height,
      depth,
      requiredDate,
      comment,
    });
    return NextResponse.json({
      ok: true,
      resent: true,
      warning: notify.warning,
    });
  }

  return NextResponse.json({ ok: true });
}
