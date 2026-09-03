import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { parseEmailList } from "@/lib/email-list";
import type {
  NotificationChannel,
  NotificationType,
  Order,
} from "@/lib/types";

export const maxDuration = 60;

const TYPES: NotificationType[] = ["missing_info", "customer_approval", "ready_to_ship"];
const CHANNELS: NotificationChannel[] = [
  "email",
  "sms",
  "both",
  "manual",
  "none",
];

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    orderId?: string;
    type?: NotificationType;
    channel?: NotificationChannel;
    staffNote?: string;
    toEmail?: string;
    toPhone?: string;
    subject?: string;
    messageBody?: string;
    ccEmails?: string[] | string;
    saveCcToAccount?: boolean;
    groupOrderIds?: string[];
  };

  if (
    !body.orderId ||
    !body.type ||
    !body.channel ||
    !TYPES.includes(body.type) ||
    !CHANNELS.includes(body.channel)
  ) {
    return NextResponse.json(
      { error: "orderId, a valid type and channel are required" },
      { status: 400 }
    );
  }

  // Normalize CC recipients from either an array or a comma/space-separated string.
  const ccRaw = Array.isArray(body.ccEmails)
    ? body.ccEmails.join(",")
    : (body.ccEmails ?? "");
  const { valid: ccEmails, invalid: ccInvalid } = parseEmailList(ccRaw);
  if (ccInvalid.length > 0) {
    return NextResponse.json(
      { error: `Not a valid email: ${ccInvalid.join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", body.orderId)
    .maybeSingle();
  if (!order || (order as Order).tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  try {
    const { notification, actionUrl, warning } = await createNotification(
      supabase,
      {
        order: order as Order,
        tenantName: ctx.tenant.name,
        type: body.type,
        channel: body.channel,
        staffNote: body.staffNote ?? null,
        toEmail: body.toEmail ?? null,
        toPhone: body.toPhone ?? null,
        ccEmails: body.ccEmails !== undefined ? ccEmails : undefined,
        saveCcToAccount: body.saveCcToAccount ?? false,
        createdBy: ctx.userId,
        subject: body.subject ?? null,
        messageBody: body.messageBody ?? null,
        groupOrderIds: Array.isArray(body.groupOrderIds)
          ? body.groupOrderIds.filter(
              (id): id is string => typeof id === "string" && id.length > 0
            )
          : undefined,
      }
    );
    return NextResponse.json({
      ok: true,
      channel: body.channel,
      token: notification.token,
      actionUrl,
      warning,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to notify";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
