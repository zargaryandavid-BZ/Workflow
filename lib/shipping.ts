import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPickupReadyEmailBody,
  buildPickupReadyEmailHtml,
  buildPickupReadySmsBody,
  buildShippingPortalEmailBody,
  buildShippingPortalEmailHtml,
  buildShippingPortalSmsBody,
  ensureShippingPortalLink,
  messageToEmailHtml,
  pickupReadySubject,
  shippingPortalSubject,
} from "@/lib/notification-messages";
import { sendTransactionalEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import type { MessageTemplateMap } from "@/lib/message-templates";
import { ensureShortCustomerUrl, appOrigin } from "@/lib/short-link";
import type { ShippingBox, ShippingDimUnit, ShippingWeightUnit } from "@/lib/types";

type ShippingRequestRow = {
  id: string;
  token: string;
  status: string;
  client_choice: string | null;
};

/**
 * Create or reuse a shipping request for a (re)send.
 * Unanswered (`pending`) choose-mode links are kept so the old portal URL still works;
 * answered / payment-pending / pickup-only flows replace the prior row(s).
 */
export async function ensureShippingRequestForSend(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    orderId: string;
    boxes: ShippingBox[];
    pickupOnly: boolean;
  }
): Promise<
  | {
      ok: true;
      shippingReq: { id: string; token: string };
      reused: boolean;
      superseded: ShippingRequestRow[];
    }
  | { ok: false; error: string }
> {
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: existingRows } = await supabase
    .from("shipping_requests")
    .select("id, token, status, client_choice")
    .eq("tenant_id", args.tenantId)
    .eq("order_id", args.orderId);
  const superseded = (existingRows ?? []) as ShippingRequestRow[];

  const reusable =
    !args.pickupOnly
      ? superseded.find((r) => r.status === "pending")
      : undefined;

  if (reusable) {
    const { data: updated, error: updateError } = await supabase
      .from("shipping_requests")
      .update({
        boxes: args.boxes,
        sent_at: nowIso,
        expires_at: expiresAt,
      })
      .eq("id", reusable.id)
      .eq("tenant_id", args.tenantId)
      .select("id, token")
      .single();

    if (updateError || !updated) {
      return {
        ok: false,
        error: updateError?.message ?? "Failed to update shipping request",
      };
    }

    return {
      ok: true,
      shippingReq: updated,
      reused: true,
      superseded,
    };
  }

  if (superseded.length > 0) {
    const { error: deleteError } = await supabase
      .from("shipping_requests")
      .delete()
      .eq("tenant_id", args.tenantId)
      .eq("order_id", args.orderId);
    if (deleteError) {
      return {
        ok: false,
        error: "Failed to replace the previous shipping request.",
      };
    }
  }

  const { data: shippingReq, error: insertError } = await supabase
    .from("shipping_requests")
    .insert({
      tenant_id: args.tenantId,
      order_id: args.orderId,
      boxes: args.boxes,
      status: args.pickupOnly ? "client_responded" : "pending",
      client_choice: args.pickupOnly ? "pickup" : null,
      sent_at: nowIso,
      responded_at: args.pickupOnly ? nowIso : null,
      expires_at: expiresAt,
    })
    .select("id, token")
    .single();

  if (insertError || !shippingReq) {
    const msg = insertError?.message?.includes("shipping_requests")
      ? "Shipping requests require migration 0044_shipping_requests.sql."
      : insertError?.message ?? "Failed to create shipping request";
    return { ok: false, error: msg };
  }

  return {
    ok: true,
    shippingReq,
    reused: false,
    superseded,
  };
}

export function parseShippingBoxes(
  rawBoxes: unknown,
  dimUnit: ShippingDimUnit,
  weightUnit: ShippingWeightUnit
): { boxes: ShippingBox[]; error?: string } {
  if (!Array.isArray(rawBoxes) || rawBoxes.length === 0) {
    return { boxes: [], error: "Add at least one box with dimensions and weight." };
  }

  const boxes: ShippingBox[] = [];
  for (let i = 0; i < rawBoxes.length; i++) {
    const row = rawBoxes[i] as Record<string, unknown>;
    const length = Number.parseFloat(String(row.length ?? ""));
    const width = Number.parseFloat(String(row.width ?? ""));
    const height = Number.parseFloat(String(row.height ?? ""));
    const weight = Number.parseFloat(String(row.weight ?? ""));
    if (
      ![length, width, height, weight].every((n) => Number.isFinite(n) && n > 0)
    ) {
      return {
        boxes: [],
        error: `Box ${i + 1} needs length, width, height, and weight greater than 0.`,
      };
    }
    boxes.push({
      length,
      width,
      height,
      weight,
      dimUnit:
        row.dimUnit === "cm" || row.dimUnit === "in"
          ? row.dimUnit
          : dimUnit,
      weightUnit:
        row.weightUnit === "kg" || row.weightUnit === "lbs"
          ? row.weightUnit
          : weightUnit,
    });
  }

  return { boxes };
}

export function formatBoxSummary(boxes: ShippingBox[]): string {
  if (boxes.length === 0) return "No boxes";
  return boxes
    .map(
      (b, i) =>
        `Box ${i + 1}: ${b.length}×${b.width}×${b.height} ${b.dimUnit}, ${b.weight} ${b.weightUnit}`
    )
    .join(" · ");
}

export async function sendShippingPortalNotifications(args: {
  email: string | null;
  phone: string | null;
  customerName: string;
  orderNumber: string;
  portalUrl: string;
  tenantName: string;
  templates?: MessageTemplateMap | null;
  /** Staff-edited subject from Ready-to-Ship popup (email only). */
  emailSubject?: string | null;
  /** Staff-edited plain-text body from Ready-to-Ship popup (email only). */
  emailBody?: string | null;
}): Promise<{ emailSent: boolean; smsSent: boolean; errors: string[] }> {
  const errors: string[] = [];
  let emailSent = false;
  let smsSent = false;
  const templates = args.templates;
  const customSubject = args.emailSubject?.trim() || null;
  const customBody = args.emailBody?.trim() || null;

  if (args.email?.trim()) {
    let html: string;
    let text: string;
    let subject: string;

    if (customBody) {
      text = ensureShippingPortalLink(customBody, args.portalUrl);
      html = messageToEmailHtml(text);
      subject =
        customSubject ||
        shippingPortalSubject(args.orderNumber, templates, {
          customer_name: args.customerName,
          portal_url: args.portalUrl,
          team_name: `${args.tenantName} Team`,
        });
    } else {
      html = buildShippingPortalEmailHtml({
        customerName: args.customerName,
        orderNumber: args.orderNumber,
        portalUrl: args.portalUrl,
        teamName: `${args.tenantName} Team`,
        templates,
      });
      text = buildShippingPortalEmailBody({
        customerName: args.customerName,
        orderNumber: args.orderNumber,
        portalUrl: args.portalUrl,
        teamName: `${args.tenantName} Team`,
        templates,
      });
      subject =
        customSubject ||
        shippingPortalSubject(args.orderNumber, templates, {
          customer_name: args.customerName,
          portal_url: args.portalUrl,
          team_name: `${args.tenantName} Team`,
        });
    }

    const result = await sendTransactionalEmail({
      to: args.email.trim(),
      subject,
      html,
      text,
    });
    emailSent = result.sent;
    if (!result.sent && result.error) errors.push(result.error);
  }

  if (args.phone?.trim()) {
    const body = buildShippingPortalSmsBody({
      customerName: args.customerName,
      orderNumber: args.orderNumber,
      portalUrl: args.portalUrl,
      templates,
    });
    const result = await sendSms({ to: args.phone.trim(), body });
    smsSent = result.sent;
    if (!result.sent && result.error) errors.push(result.error);
  }

  return { emailSent, smsSent, errors };
}

/**
 * Notify the customer their order is ready for pickup — used when staff already
 * know it's a pickup, so no pickup/delivery choice is presented.
 */
export async function sendPickupReadyNotifications(args: {
  email: string | null;
  phone: string | null;
  customerName: string;
  orderNumber: string;
  portalUrl: string;
  pickupLocation: string;
  pickupHours: string;
  tenantName: string;
  templates?: MessageTemplateMap | null;
  /** Staff-edited subject from Ready-to-Ship popup (email only). */
  emailSubject?: string | null;
  /** Staff-edited plain-text body from Ready-to-Ship popup (email only). */
  emailBody?: string | null;
}): Promise<{ emailSent: boolean; smsSent: boolean; errors: string[] }> {
  const errors: string[] = [];
  let emailSent = false;
  let smsSent = false;
  const templates = args.templates;
  const teamName = `${args.tenantName} Team`;
  const customSubject = args.emailSubject?.trim() || null;
  const customBody = args.emailBody?.trim() || null;

  if (args.email?.trim()) {
    let html: string;
    let text: string;
    let subject: string;

    if (customBody) {
      text = ensureShippingPortalLink(customBody, args.portalUrl);
      html = messageToEmailHtml(text);
      subject =
        customSubject ||
        pickupReadySubject(args.orderNumber, templates, {
          customer_name: args.customerName,
          portal_url: args.portalUrl,
          pickup_location: args.pickupLocation,
          pickup_hours: args.pickupHours,
          team_name: teamName,
        });
    } else {
      html = buildPickupReadyEmailHtml({
        customerName: args.customerName,
        orderNumber: args.orderNumber,
        portalUrl: args.portalUrl,
        pickupLocation: args.pickupLocation,
        pickupHours: args.pickupHours,
        teamName,
        templates,
      });
      text = buildPickupReadyEmailBody({
        customerName: args.customerName,
        orderNumber: args.orderNumber,
        portalUrl: args.portalUrl,
        pickupLocation: args.pickupLocation,
        pickupHours: args.pickupHours,
        teamName,
        templates,
      });
      subject =
        customSubject ||
        pickupReadySubject(args.orderNumber, templates, {
          customer_name: args.customerName,
          portal_url: args.portalUrl,
          pickup_location: args.pickupLocation,
          pickup_hours: args.pickupHours,
          team_name: teamName,
        });
    }

    const result = await sendTransactionalEmail({
      to: args.email.trim(),
      subject,
      html,
      text,
    });
    emailSent = result.sent;
    if (!result.sent && result.error) errors.push(result.error);
  }

  if (args.phone?.trim()) {
    const body = buildPickupReadySmsBody({
      customerName: args.customerName,
      orderNumber: args.orderNumber,
      portalUrl: args.portalUrl,
      pickupLocation: args.pickupLocation,
      pickupHours: args.pickupHours,
      templates,
    });
    const result = await sendSms({ to: args.phone.trim(), body });
    smsSent = result.sent;
    if (!result.sent && result.error) errors.push(result.error);
  }

  return { emailSent, smsSent, errors };
}

export function appBaseUrl(): string {
  return appOrigin();
}

export async function shippingPortalPublicUrl(
  client: SupabaseClient,
  tenantId: string,
  token: string
): Promise<string> {
  return ensureShortCustomerUrl(client, tenantId, `/shipping/${token}`);
}
