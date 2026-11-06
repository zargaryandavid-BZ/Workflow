import "server-only";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity, onEnterColumn } from "@/lib/automation";
import { formatShortOrderNumber } from "@/lib/board-order-filters";
import { materializeDueOnProductionMove } from "@/lib/due-date-on-move.server";
import { fireNotificationRules } from "@/lib/fire-notification-rules";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import { PICKUP_CODE_SPEC_KEY, pickupCodeFromSpecs } from "@/lib/pickup-code";
import {
  generatePickupReceiptPdf,
  pickupReceiptFileName,
} from "@/lib/pickup-receipt-pdf";
import { isPickupSelectedColumnName } from "@/lib/shipping-opt-column";
import { maybeStopPrepressTimersOnColumnLeave } from "@/lib/stop-order-timers";
import type { BoardColumn, Order } from "@/lib/types";
import { loadOrderExportData } from "@/lib/button-automation-order-data";
import { sendTransactionalEmail } from "@/lib/email";
import {
  checkPickupCode,
  decodePickupSignaturePng,
  formatPickupDateTime,
  pickupConfirmationFromSpecs,
  pickupRecipientName,
  type PickupConfirmation,
  type PickupConfirmationInput,
} from "@/lib/fulfillment-pickup";
import { getMessageTemplates } from "@/lib/message-templates.server";
import {
  buildOrderPickedUpEmailBody,
  buildOrderPickedUpEmailHtml,
  buildOrderPickedUpSmsBody,
  orderPickedUpEmailSubject,
} from "@/lib/notification-messages";
import { insertOrderSmsMessage } from "@/lib/order-sms";
import { sendSms } from "@/lib/sms";
import { automaticNotifyChannels } from "@/lib/preferred-channel";
import { loadOrderCustomerNotifyPreference } from "@/lib/customer-notify-preference.server";

export type PickupCustomerNotice = {
  emailSent: boolean;
  smsSent: boolean;
  message: string;
};

function customerNotice(args: {
  pickedUpBy: string;
  pickedUpAt: string;
  email: string | null;
  phone: string | null;
  emailSent: boolean;
  smsSent: boolean;
  errors: string[];
}): string {
  const detail = `${args.pickedUpBy} on ${args.pickedUpAt}`;
  if (args.emailSent && args.smsSent) {
    return `The customer was emailed and texted that the order was picked up by ${detail}.`;
  }
  if (args.emailSent) {
    return `The customer was emailed that the order was picked up by ${detail}.`;
  }
  if (args.smsSent) {
    return `The customer was texted that the order was picked up by ${detail}.`;
  }
  if (!args.email && !args.phone) {
    return "Pickup saved. This order has no customer email or phone, so no message was sent.";
  }
  const reason = args.errors[0]?.trim();
  return reason
    ? `Pickup saved. The customer message could not be sent: ${reason}`
    : "Pickup saved. The customer message could not be sent.";
}

export async function notifyCustomerOrderPickedUp(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    orderId: string;
    confirmation: PickupConfirmation;
  }
): Promise<PickupCustomerNotice> {
  const pickedUpBy = pickupRecipientName(
    args.confirmation.first_name,
    args.confirmation.last_name
  );
  const pickedUpAt = formatPickupDateTime(args.confirmation.picked_up_at);

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", args.tenantId)
    .maybeSingle();
  const tenantName =
    (typeof tenant?.name === "string" && tenant.name.trim()) ||
    "Bazaar Printing";
  const teamName = `${tenantName} Team`;

  const data = await loadOrderExportData(
    supabase,
    args.orderId,
    args.tenantId,
    tenantName
  );
  const email = data?.customerEmail?.trim() || null;
  const phone = data?.customerPhone?.trim() || null;
  const orderNumber =
    data?.orderNumberDisplay?.trim() ||
    data?.orderNumber?.trim() ||
    "your order";
  const customerName =
    data?.customerName && data.customerName !== "—"
      ? data.customerName
      : "there";

  if (!email && !phone) {
    return {
      emailSent: false,
      smsSent: false,
      message: customerNotice({
        pickedUpBy,
        pickedUpAt,
        email,
        phone,
        emailSent: false,
        smsSent: false,
        errors: [],
      }),
    };
  }

  const templates = await getMessageTemplates(supabase, args.tenantId);
  const smsBody = buildOrderPickedUpSmsBody({
    customerName,
    orderNumber,
    pickedUpBy,
    pickedUpAt,
    brand: tenantName,
    templates,
  });
  const emailText = buildOrderPickedUpEmailBody({
    customerName,
    orderNumber,
    pickedUpBy,
    pickedUpAt,
    teamName,
    brand: tenantName,
    templates,
  });

  let emailSent = false;
  let smsSent = false;
  const errors: string[] = [];

  // Honor the customer's saved Email / SMS / Both default. Customers who never
  // chose keep the old behavior (every contact on file).
  const pref = await loadOrderCustomerNotifyPreference(
    supabase,
    args.orderId,
    args.tenantId
  );
  const use = automaticNotifyChannels({
    email,
    phone,
    preferred: pref.preferred,
    explicit: pref.explicit,
  });

  if (email && use.email) {
    const result = await sendTransactionalEmail({
      to: email,
      subject: orderPickedUpEmailSubject(orderNumber, templates, {
        customer_name: customerName,
        picked_up_by: pickedUpBy,
        picked_up_at: pickedUpAt,
        team_name: teamName,
        brand: tenantName,
      }),
      html: buildOrderPickedUpEmailHtml({
        customerName,
        orderNumber,
        pickedUpBy,
        pickedUpAt,
        teamName,
        brand: tenantName,
        templates,
      }),
      text: emailText,
    });
    emailSent = result.sent;
    if (!result.sent && result.error) errors.push(result.error);
  }

  if (phone && use.sms) {
    const result = await sendSms({ to: phone, body: smsBody });
    smsSent = result.sent;
    if (!result.sent && result.error) errors.push(result.error);
    if (result.sent) {
      await insertOrderSmsMessage(supabase, {
        tenantId: args.tenantId,
        orderId: args.orderId,
        direction: "outbound",
        phone,
        body: smsBody,
        twilioSid: result.sid ?? null,
      });
    }
  }

  await logActivity(supabase, {
    tenantId: args.tenantId,
    orderId: args.orderId,
    actor: null,
    action: "order_picked_up_sent",
    metadata: {
      pickedUpBy,
      pickedUpAt,
      emailSent,
      smsSent,
      errors,
      // Only the channels actually attempted, so history shows what went out.
      email: (use.email && email) || undefined,
      phone: (use.sms && phone) || undefined,
      channel:
        emailSent && smsSent
          ? "both"
          : emailSent
            ? "email"
            : smsSent
              ? "sms"
              : undefined,
      messageBody: smsSent ? smsBody : emailText,
      emailBody: emailText,
    },
  });

  if (errors.length > 0) {
    console.error("[pickup] customer notify errors", args.orderId, errors);
  }

  return {
    emailSent,
    smsSent,
    message: customerNotice({
      pickedUpBy,
      pickedUpAt,
      email,
      phone,
      emailSent,
      smsSent,
      errors,
    }),
  };
}

type PickupOrderRow = {
  id: string;
  title: string;
  column_id: string | null;
  specs: Record<string, unknown>;
};

function specsObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

async function loadPickupOrder(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string
): Promise<PickupOrderRow | null> {
  const { data } = await supabase
    .from("orders")
    .select("id, title, column_id, specs")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .maybeSingle();
  if (!data) return null;
  return { ...(data as PickupOrderRow), specs: specsObject(data.specs) };
}

/** Every part the pickup message covered (same code), else just this card. */
async function loadPickupParts(
  supabase: SupabaseClient,
  tenantId: string,
  order: PickupOrderRow,
  code: string | null
): Promise<PickupOrderRow[]> {
  if (!code) return [order];
  const { data } = await supabase
    .from("orders")
    .select("id, title, column_id, specs")
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .eq(`specs->>${PICKUP_CODE_SPEC_KEY}`, code)
    .order("title", { ascending: true })
    .limit(50);
  const rows = ((data ?? []) as PickupOrderRow[]).map((row) => ({
    ...row,
    specs: specsObject(row.specs),
  }));
  return rows.some((row) => row.id === order.id) ? rows : [order, ...rows];
}

/** The board's "Pickups" column (same name rule as the portal's pickup choice). */
async function findPickupsColumn(
  supabase: SupabaseClient,
  tenantId: string
): Promise<BoardColumn | null> {
  const { data } = await supabase
    .from("board_columns")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });
  const columns = (data ?? []) as BoardColumn[];
  return columns.find((column) => isPickupSelectedColumnName(column.name)) ?? null;
}

export type PickupStatus = {
  codeRequired: boolean;
  alreadyPickedUp: { pickedUpBy: string; pickedUpAt: string } | null;
  pickupsColumnName: string | null;
  partCount: number;
};

/** GET for the Pickup window: does it need a code, was it already picked up? */
export async function loadPickupStatus(args: {
  supabase: SupabaseClient;
  tenantId: string;
  orderId: string;
}): Promise<PickupStatus | { error: string; status: number }> {
  const orderId = args.orderId.trim();
  if (!orderId) return { error: "order_id is required", status: 400 };
  const order = await loadPickupOrder(args.supabase, args.tenantId, orderId);
  if (!order) return { error: "Order not found", status: 404 };
  const code = pickupCodeFromSpecs(order.specs);
  const [parts, column] = await Promise.all([
    loadPickupParts(args.supabase, args.tenantId, order, code),
    findPickupsColumn(args.supabase, args.tenantId),
  ]);
  const previous = pickupConfirmationFromSpecs(order.specs);
  return {
    codeRequired: Boolean(code),
    alreadyPickedUp: previous
      ? {
          pickedUpBy: pickupRecipientName(previous.first_name, previous.last_name),
          pickedUpAt: formatPickupDateTime(previous.picked_up_at),
        }
      : null,
    pickupsColumnName: column?.name?.trim() || null,
    partCount: parts.length,
  };
}

/**
 * Move a signed-for card into Pickups with the same hooks as a scan move
 * (due date, prepress timers, activity, partner portal, column rules).
 */
async function moveToPickupsColumn(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string,
  column: BoardColumn
): Promise<boolean> {
  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!order || order.column_id === column.id) return false;

  const now = new Date().toISOString();
  const { data: moved, error } = await supabase
    .from("orders")
    .update({ column_id: column.id, last_moved_at: now })
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .filter("column_id", order.column_id == null ? "is" : "eq", order.column_id ?? null)
    .select("id");
  if (error) throw new Error(error.message);
  if (!moved?.length) return false;

  await materializeDueOnProductionMove(supabase, {
    tenantId,
    orderId,
    fromColumnId: order.column_id as string | null,
    toColumnId: column.id,
    movedAt: now,
  });
  const { data: source } = await supabase
    .from("board_columns")
    .select("name")
    .eq("id", order.column_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  await maybeStopPrepressTimersOnColumnLeave({
    tenantId,
    orderId,
    fromColumn: { name: (source as { name?: string } | null)?.name },
    toColumn: { name: column.name },
  });

  const movedOrder = { ...order, column_id: column.id } as Order;
  after(async () => {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .maybeSingle();
    const tenantName = (tenant as { name?: string } | null)?.name ?? "";
    try {
      await logActivity(supabase, {
        tenantId,
        orderId,
        actor: null,
        action: "moved",
        metadata: {
          from: order.column_id,
          to: column.id,
          toName: column.name,
          via: "pickup_signature",
        },
      });
    } catch (err) {
      console.error("[pickup] logActivity failed:", err);
    }
    try {
      const { notifyBazaarPortalCurrentColumn } = await import("@/lib/bazaar-portal-sync");
      await notifyBazaarPortalCurrentColumn({ tenantId, orderId });
    } catch (err) {
      console.error("[pickup] bazaar-portal-sync failed:", err);
    }
    try {
      await onEnterColumn(supabase, movedOrder, column, tenantName, null);
    } catch (err) {
      console.error("[pickup] onEnterColumn failed:", err);
    }
    try {
      await fireNotificationRules(orderId, column.id, tenantId);
    } catch (err) {
      console.error("[pickup] fireNotificationRules failed:", err);
    }
  });
  return true;
}

export type PickupSaveResult = {
  confirmation: PickupConfirmation;
  customerNotified: PickupCustomerNotice;
  /** Column the signed parts now sit in, or null when the board has no Pickups column. */
  movedTo: string | null;
  movedToColumnId: string | null;
  orderNumbers: string[];
};

export async function savePickupAndNotifyCustomer(args: {
  supabase: SupabaseClient;
  tenantId: string;
  input: PickupConfirmationInput;
}): Promise<
  | PickupSaveResult
  | {
      error: string;
      status: number;
      alreadyPickedUp?: { pickedUpBy: string; pickedUpAt: string };
    }
> {
  const { supabase, tenantId, input } = args;
  const orderId = input.orderId.trim();
  const firstName = input.firstName.trim().slice(0, 100);
  const lastName = input.lastName.trim().slice(0, 100);
  if (!orderId || !firstName || !lastName) {
    return { error: "Order, first name, and last name are required", status: 400 };
  }
  const signature = decodePickupSignaturePng(input.signatureDataUrl);
  if (!signature) return { error: "A valid signature is required", status: 400 };

  const order = await loadPickupOrder(supabase, tenantId, orderId);
  if (!order) return { error: "Order not found", status: 404 };

  const code = pickupCodeFromSpecs(order.specs);
  const codeCheck = checkPickupCode(code, input.pickupCode);
  if (codeCheck === "missing") {
    return { error: "Enter the 8-digit pickup code from the customer's message.", status: 400 };
  }
  if (codeCheck === "wrong") {
    return { error: "That pickup code doesn't match this order.", status: 400 };
  }

  const previous = pickupConfirmationFromSpecs(order.specs);
  if (previous && !input.confirmAgain) {
    const alreadyPickedUp = {
      pickedUpBy: pickupRecipientName(previous.first_name, previous.last_name),
      pickedUpAt: formatPickupDateTime(previous.picked_up_at),
    };
    return {
      error: `Already picked up by ${alreadyPickedUp.pickedUpBy} on ${alreadyPickedUp.pickedUpAt}.`,
      status: 409,
      alreadyPickedUp,
    };
  }

  const parts = await loadPickupParts(supabase, tenantId, order, code);
  const orderNumbers = parts.map((part) => formatShortOrderNumber(part.title) || part.title);
  const pickedUpAt = new Date().toISOString();
  const stamp = pickedUpAt.replace(/[:.]/g, "-");
  const pickedUpBy = pickupRecipientName(firstName, lastName);

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();
  const shopName = (tenant as { name?: string } | null)?.name?.trim() || "Bazaar Printing";

  const receipt = await generatePickupReceiptPdf({
    shopName,
    orderNumbers,
    pickedUpBy,
    pickedUpAt: formatPickupDateTime(pickedUpAt),
    codeLast4: code ? code.slice(-4) : null,
    signaturePng: signature,
  });

  const uploaded: string[] = [];
  const cleanup = async () => {
    if (uploaded.length) {
      await supabase.storage.from(ORDER_ASSETS_BUCKET).remove(uploaded);
    }
  };

  const signaturePath = `${tenantId}/${orderId}/pickup/${stamp}.png`;
  const { error: signatureError } = await supabase.storage
    .from(ORDER_ASSETS_BUCKET)
    .upload(signaturePath, signature, { contentType: "image/png", upsert: false });
  if (signatureError) return { error: signatureError.message, status: 500 };
  uploaded.push(signaturePath);

  let scannedConfirmation: PickupConfirmation | null = null;
  const oldFiles: string[] = [];
  const oldAssetIds: string[] = [];

  for (const part of parts) {
    // Each part gets its own copy of the PDF in its Files, so removing it on
    // one card never breaks another card's link.
    const fileName = pickupReceiptFileName(formatShortOrderNumber(part.title) || part.title);
    const receiptPath = `${tenantId}/${part.id}/assets/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: receiptError } = await supabase.storage
      .from(ORDER_ASSETS_BUCKET)
      .upload(receiptPath, receipt, { contentType: "application/pdf", upsert: false });
    if (receiptError) {
      await cleanup();
      return { error: receiptError.message, status: 500 };
    }
    uploaded.push(receiptPath);

    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .insert({
        tenant_id: tenantId,
        order_id: part.id,
        sku_key: null,
        file_name: fileName,
        storage_path: receiptPath,
        mime_type: "application/pdf",
        size: receipt.length,
        uploaded_by: null,
      })
      .select("id")
      .single();
    if (assetError) {
      await cleanup();
      return { error: assetError.message, status: 500 };
    }

    const before = pickupConfirmationFromSpecs(part.specs);
    if (before) {
      if (before.receipt_path) oldFiles.push(before.receipt_path);
      if (before.receipt_asset_id) oldAssetIds.push(before.receipt_asset_id);
      if (before.signature_path && before.signature_path !== signaturePath) {
        oldFiles.push(before.signature_path);
      }
    }

    const confirmation: PickupConfirmation = {
      first_name: firstName,
      last_name: lastName,
      picked_up_at: pickedUpAt,
      signature_path: signaturePath,
      code,
      receipt_path: receiptPath,
      receipt_asset_id: (asset as { id: string }).id,
      order_ids: parts.map((p) => p.id),
    };
    // Re-read so a write between the scan and now (tags, notes) isn't lost.
    const fresh = await loadPickupOrder(supabase, tenantId, part.id);
    const { error: updateError } = await supabase
      .from("orders")
      .update({ specs: { ...(fresh?.specs ?? part.specs), pickup_confirmation: confirmation } })
      .eq("id", part.id)
      .eq("tenant_id", tenantId);
    if (updateError) {
      await supabase.from("assets").delete().eq("id", (asset as { id: string }).id);
      await cleanup();
      return { error: updateError.message, status: 500 };
    }
    if (part.id === orderId) scannedConfirmation = confirmation;
  }

  // Signing again replaces the old signature + PDF instead of piling them up.
  if (oldAssetIds.length) {
    await supabase.from("assets").delete().in("id", oldAssetIds);
  }
  const staleFiles = [...new Set(oldFiles)].filter((path) => !uploaded.includes(path));
  if (staleFiles.length) {
    await supabase.storage.from(ORDER_ASSETS_BUCKET).remove(staleFiles);
  }

  // Signed → Pickups column.
  let movedTo: string | null = null;
  let movedToColumnId: string | null = null;
  try {
    const column = await findPickupsColumn(supabase, tenantId);
    if (column) {
      movedTo = column.name.trim();
      movedToColumnId = column.id;
      for (const part of parts) {
        await moveToPickupsColumn(supabase, tenantId, part.id, column);
      }
    }
  } catch (err) {
    console.error("[pickup] move to Pickups failed", orderId, err);
    movedTo = null;
    movedToColumnId = null;
  }

  const confirmation = scannedConfirmation!;

  // One "picked up" message per pickup; signing again doesn't text twice.
  if (previous) {
    return {
      confirmation,
      customerNotified: {
        emailSent: false,
        smsSent: false,
        message: "Signature replaced. The customer was already told about this pickup.",
      },
      movedTo,
      movedToColumnId,
      orderNumbers,
    };
  }

  try {
    const customerNotified = await notifyCustomerOrderPickedUp(supabase, {
      tenantId,
      orderId,
      confirmation,
    });
    return { confirmation, customerNotified, movedTo, movedToColumnId, orderNumbers };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Customer message failed";
    console.error("[pickup] customer notify failed", reason);
    return {
      confirmation,
      customerNotified: {
        emailSent: false,
        smsSent: false,
        message: `Pickup saved. The customer message could not be sent: ${reason}`,
      },
      movedTo,
      movedToColumnId,
      orderNumbers,
    };
  }
}
