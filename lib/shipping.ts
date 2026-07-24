import "server-only";

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
import type { ShippingBox, ShippingDimUnit, ShippingWeightUnit } from "@/lib/types";

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
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}
