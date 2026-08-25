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
import { collectDieUploadFiles } from "@/lib/die-request";
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
  const manufacturerId = String(form.get("manufacturerId") ?? "").trim();
  const comment = String(form.get("comment") ?? "").trim() || null;
  const widthRaw = String(form.get("width") ?? "").trim();
  const heightRaw = String(form.get("height") ?? "").trim();
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
  const primary = primaryDieFileFields(stored.files);

  const { data: inserted, error: insertError } = await supabase
    .from("die_requests")
    .insert({
      tenant_id: ctx.tenant.id,
      order_id: orderId,
      width,
      height,
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
    })
    .select("id, token")
    .single();

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
  const widthLabel = width != null ? String(width) : "—";
  const heightLabel = height != null ? String(height) : "—";

  const requiredLabel = formatDate(requiredDate) || requiredDate;
  const notify = await notifyDieManufacturer({
    manufacturer: mapDieManufacturerRow(manufacturer as Record<string, unknown>),
    email: {
      subject: dieQuoteSubject(order.title),
      html: (contactName) =>
        buildDieQuoteEmailHtml({
          orderNumber: order.title,
          width: widthLabel,
          height: heightLabel,
          requiredDate: requiredLabel,
          quoteUrl,
          comment,
          contactName,
        }),
      text: (contactName) =>
        buildDieQuoteEmailBody({
          orderNumber: order.title,
          width: widthLabel,
          height: heightLabel,
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

  return NextResponse.json({
    ok: true,
    id: inserted.id,
    warning: notify.warning,
  });
}
