import "server-only";

import {
  buildShippingPortalEmailBody,
  buildShippingPortalEmailHtml,
  buildShippingPortalSmsBody,
  shippingPortalSubject,
} from "@/lib/notification-messages";
import { sendTransactionalEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
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
}): Promise<{ emailSent: boolean; smsSent: boolean; errors: string[] }> {
  const errors: string[] = [];
  let emailSent = false;
  let smsSent = false;

  if (args.email?.trim()) {
    const html = buildShippingPortalEmailHtml({
      customerName: args.customerName,
      orderNumber: args.orderNumber,
      portalUrl: args.portalUrl,
      teamName: `${args.tenantName} Team`,
    });
    const text = buildShippingPortalEmailBody({
      customerName: args.customerName,
      orderNumber: args.orderNumber,
      portalUrl: args.portalUrl,
      teamName: `${args.tenantName} Team`,
    });
    const result = await sendTransactionalEmail({
      to: args.email.trim(),
      subject: shippingPortalSubject(args.orderNumber),
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
