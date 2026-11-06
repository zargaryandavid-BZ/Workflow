import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { notifyDieManufacturer } from "@/lib/die-notify";
import {
  buildDieQuoteEmailBody,
  buildDieQuoteEmailHtml,
  buildDieQuoteSmsBody,
  dieQuoteSubject,
} from "@/lib/die-request-messages";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { ensureShortCustomerUrl } from "@/lib/short-link";
import { formatDate } from "@/lib/utils";
import { isValidEmail, mapDieManufacturerRow } from "@/lib/die-manufacturers";
import {
  DIE_MAX_FILES,
  DIE_PAST_DATE_ERROR,
  isDieDatePast,
  collectDieUploadFiles,
  formatDieSize,
  parseOptionalDieDim,
} from "@/lib/die-request";
import { diePdfRef, markDieOnOrder } from "@/lib/dies.server";
import {
  primaryDieFileFields,
  storeDieRequestFiles,
} from "@/lib/die-request-upload";

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const orderId = String(form.get("orderId") ?? "").trim();
  const dieId = String(form.get("dieId") ?? "").trim() || null;
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

  if (!orderId || !manufacturerId || !requiredDate) {
    return NextResponse.json(
      { error: "Order, die manufacturer, and required date are required." },
      { status: 422 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requiredDate)) {
    return NextResponse.json(
      { error: "Required date must be YYYY-MM-DD." },
      { status: 422 }
    );
  }
  if (isDieDatePast(requiredDate)) {
    return NextResponse.json(
      { error: `Required date is in the past. ${DIE_PAST_DATE_ERROR}` },
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
  if (dieId) {
    const { data: die, error: dieError } = await supabase
      .from("dies")
      .select("id, deleted_at")
      .eq("id", dieId)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (!dieError && !die) {
      return NextResponse.json({ error: "Die not found." }, { status: 404 });
    }
    if ((die as { deleted_at?: string | null } | null)?.deleted_at) {
      return NextResponse.json({ error: "This die was deleted." }, { status: 409 });
    }
  }
  const { data: order } = await supabase
    .from("orders")
    .select("id, title, tenant_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { data: manufacturer, error: mfgError } = await supabase
    .from("die_manufacturers")
    .select("*")
    .eq("id", manufacturerId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (mfgError && /die_manufacturers|schema cache|does not exist/i.test(mfgError.message)) {
    return NextResponse.json(
      { error: "Run migration 0085_die_manufacturers.sql in Supabase, then try again." },
      { status: 400 }
    );
  }
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

  const stored = await storeDieRequestFiles(
    supabase,
    ctx.tenant.id,
    orderId,
    incomingFiles
  );
  if ("error" in stored) {
    return NextResponse.json({ error: stored.error }, { status: 422 });
  }
  // A request for a die always carries the die's PDF (same stored file).
  if (dieId) {
    const pdf = await diePdfRef(supabase, ctx.tenant.id, dieId);
    if (pdf && !stored.files.some((f) => f.path === pdf.path)) {
      stored.files = [
        { path: pdf.path, name: pdf.name, mime: "application/pdf" },
        ...stored.files,
      ].slice(0, DIE_MAX_FILES);
    }
  }
  const primary = primaryDieFileFields(stored.files);

  const insertRow: Record<string, unknown> = {
      tenant_id: ctx.tenant.id,
      order_id: orderId,
      width,
      height,
      depth,
      product_name: productName,
      required_date: requiredDate,
      allow_own_date: allowOwnDate,
      to_email: toEmail,
      manufacturer_id: manufacturerId,
      comment,
      files: stored.files,
      file_path: primary.file_path,
      file_name: primary.file_name,
      file_mime: primary.file_mime,
      status: "sent",
      created_by: ctx.userId,
      ...(dieId ? { die_id: dieId } : {}),
    };

  let { data: inserted, error: insertError } = await supabase
    .from("die_requests")
    .insert(insertRow)
    .select("id, token")
    .single();

  if (insertError && dieId && /die_id/i.test(insertError.message)) {
    // Before migration 0093: send the request without the die link.
    delete insertRow.die_id;
    const retry = await supabase
      .from("die_requests")
      .insert(insertRow)
      .select("id, token")
      .single();
    inserted = retry.data;
    insertError = retry.error;
  }
  if (
    insertError &&
    /depth|product_name/i.test(insertError.message)
  ) {
    delete insertRow.depth;
    delete insertRow.product_name;
    const retry = await supabase
      .from("die_requests")
      .insert(insertRow)
      .select("id, token")
      .single();
    inserted = retry.data;
    insertError = retry.error;
  }

  if (insertError || !inserted) {
    const msg = insertError?.message ?? "Failed to save die request";
    const needs0087 = /files/i.test(msg);
    const needs0085 = /manufacturer_id|comment|die_manufacturers/i.test(msg);
    const needs0090 = /allow_own_date/i.test(msg);
    return NextResponse.json(
      {
        error: needs0090
          ? "Run migration 0090_die_allow_own_date.sql in Supabase, then try again."
          : needs0087
          ? "Run migration 0087_die_request_files.sql in Supabase, then try again."
          : needs0085
          ? "Run migration 0085_die_manufacturers.sql in Supabase, then try again."
          : /depth|product_name/i.test(msg)
            ? "Run migration 0091_die_request_depth_product.sql in Supabase, then try again."
          : msg.includes("die_requests")
            ? "Run migration 0084_die_requests.sql in Supabase, then try again."
            : msg,
      },
      { status: 400 }
    );
  }

  const quotePath = `/die/${inserted.token}`;
  const quoteUrl = await ensureShortCustomerUrl(
    supabase,
    ctx.tenant.id,
    quotePath
  );
  const sizeLabel = formatDieSize(width, height, depth);

  const requiredLabel = formatDate(requiredDate) || requiredDate;
  const notify = await notifyDieManufacturer({
    manufacturer: mapDieManufacturerRow(manufacturer as Record<string, unknown>),
    email: {
      subject: dieQuoteSubject(order.title),
      html: (contactName) =>
        buildDieQuoteEmailHtml({
          orderNumber: order.title,
          productName,
          size: sizeLabel,
          requiredDate: requiredLabel,
          quoteUrl,
          comment,
          contactName,
        }),
      text: (contactName) =>
        buildDieQuoteEmailBody({
          orderNumber: order.title,
          productName,
          size: sizeLabel,
          requiredDate: requiredLabel,
          quoteUrl,
          comment,
          contactName,
        }),
    },
    smsBody: buildDieQuoteSmsBody({
      orderNumber: order.title,
      requiredDate: requiredLabel,
      quoteUrl,
    }),
  });

  // History + "on order": a die ordered as a new die stays off the Dies tab
  // until this request is marked received.
  if (dieId) {
    await markDieOnOrder(supabase, {
      tenantId: ctx.tenant.id,
      dieId,
      actor: { id: ctx.userId, name: ctx.fullName || ctx.email },
      manufacturerName:
        String((manufacturer as { full_name?: string }).full_name ?? "").trim() || null,
      newDie: form.get("newDieOrder") === "true",
    });
  }

  return NextResponse.json({
    ok: true,
    id: inserted.id,
    warning: notify.warning,
  });
}
