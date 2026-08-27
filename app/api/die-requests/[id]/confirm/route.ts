import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { notifyDieManufacturer } from "@/lib/die-notify";
import {
  buildDieOrderConfirmEmailBody,
  buildDieOrderConfirmEmailHtml,
  buildDieOrderConfirmSmsBody,
  dieOrderConfirmSubject,
} from "@/lib/die-request-messages";
import { formatDieQuotedPrice, formatDieSize } from "@/lib/die-request";
import { ensureShortCustomerUrl } from "@/lib/short-link";
import { formatDate } from "@/lib/utils";

export async function POST(
  _request: Request,
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
  const supabase = await createClient();
  const withDepth =
    "id, tenant_id, order_id, token, status, width, height, depth, product_name, comment, quoted_price, time_estimate, confirmed_due_date, manufacturer_id, to_email, order:orders(title)";
  const withoutDepth =
    "id, tenant_id, order_id, token, status, width, height, comment, quoted_price, time_estimate, confirmed_due_date, manufacturer_id, to_email, order:orders(title)";
  let req: Record<string, unknown> | null = null;
  const first = await supabase
    .from("die_requests")
    .select(withDepth)
    .eq("id", id)
    .maybeSingle();
  let findError = first.error;
  if (first.error && /depth|product_name/i.test(first.error.message)) {
    const retry = await supabase
      .from("die_requests")
      .select(withoutDepth)
      .eq("id", id)
      .maybeSingle();
    req = (retry.data ?? null) as Record<string, unknown> | null;
    findError = retry.error;
  } else {
    req = (first.data ?? null) as Record<string, unknown> | null;
  }

  if (findError || !req || req.tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (req.status === "ordered") {
    return NextResponse.json(
      { error: "Final request was already sent." },
      { status: 409 }
    );
  }
  if (req.status !== "quoted") {
    return NextResponse.json(
      { error: "Wait for the manufacturer quote before confirming." },
      { status: 422 }
    );
  }
  if (!req.confirmed_due_date) {
    return NextResponse.json(
      { error: "Quote is missing a confirmed due date." },
      { status: 422 }
    );
  }

  const order = req.order as { title?: string } | { title?: string }[] | null;
  const orderTitle =
    (Array.isArray(order) ? order[0]?.title : order?.title) ?? "Order";
  const rec = req as Record<string, unknown>;
  const sizeLabel = formatDieSize(
    rec.width == null ? null : Number(rec.width),
    rec.height == null ? null : Number(rec.height),
    rec.depth == null ? null : Number(rec.depth)
  );
  const productName = rec.product_name ? String(rec.product_name) : null;
  const dueLabel =
    formatDate(String(req.confirmed_due_date).slice(0, 10)) ||
    String(req.confirmed_due_date).slice(0, 10);
  const priceLabel = formatDieQuotedPrice(
    req.quoted_price == null ? null : Number(req.quoted_price)
  );
  const timeLabel = String(req.time_estimate ?? "—");
  const comment = req.comment ? String(req.comment) : null;
  const orderUrl = await ensureShortCustomerUrl(
    supabase,
    ctx.tenant.id,
    `/die/${req.token}`
  );

  let manufacturer: Record<string, unknown> | null = null;
  if (req.manufacturer_id) {
    const { data } = await supabase
      .from("die_manufacturers")
      .select("*")
      .eq("id", req.manufacturer_id)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    manufacturer = data as Record<string, unknown> | null;
  }
  if (!manufacturer) {
    manufacturer = {
      full_name: "",
      email: req.to_email,
      phone: null,
      contact_name: null,
      contact_name_2: null,
      email_2: null,
      phone_2: null,
    };
  }

  const { error: updateError } = await supabase
    .from("die_requests")
    .update({
      status: "ordered",
      ordered_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (updateError) {
    return NextResponse.json(
      {
        error: /ordered|status/i.test(updateError.message)
          ? "Run migration 0089_die_request_ordered.sql in Supabase, then try again."
          : updateError.message,
      },
      { status: 400 }
    );
  }

  const notify = await notifyDieManufacturer({
    manufacturer,
    email: {
      subject: dieOrderConfirmSubject(orderTitle),
      html: (contactName) =>
        buildDieOrderConfirmEmailHtml({
          orderNumber: orderTitle,
          productName,
          size: sizeLabel,
          confirmedDueDate: dueLabel,
          price: priceLabel,
          timeEstimate: timeLabel,
          comment,
          orderUrl,
          contactName,
        }),
      text: (contactName) =>
        buildDieOrderConfirmEmailBody({
          orderNumber: orderTitle,
          productName,
          size: sizeLabel,
          confirmedDueDate: dueLabel,
          price: priceLabel,
          timeEstimate: timeLabel,
          comment,
          orderUrl,
          contactName,
        }),
    },
    smsBody: buildDieOrderConfirmSmsBody({
      orderNumber: orderTitle,
      confirmedDueDate: dueLabel,
      price: priceLabel,
      orderUrl,
    }),
  });

  return NextResponse.json({
    ok: true,
    warning: notify.warning,
  });
}
