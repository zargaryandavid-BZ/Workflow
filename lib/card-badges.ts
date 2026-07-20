import type {
  CustomerResponse,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
} from "@/lib/types";

export type CardNotificationBadge =
  | "waiting"
  | "responded"
  | "waiting_approval"
  | "manual"
  | "approved"
  | "rejected";

export const CARD_BADGE_STYLES: Record<CardNotificationBadge, string> = {
  waiting: "bg-amber-100 text-amber-700 border border-amber-200",
  responded: "bg-green-100 text-green-700 border border-green-200",
  waiting_approval: "bg-amber-100 text-amber-700 border border-amber-200",
  manual: "bg-slate-100 text-slate-600 border border-slate-200",
  approved: "bg-green-100 text-green-700 border border-green-200",
  rejected: "bg-red-100 text-red-700 border border-red-200",
};

export const CARD_BADGE_LABELS: Record<CardNotificationBadge, string> = {
  waiting: "⏳ Waiting",
  responded: "✓ Client responded",
  waiting_approval: "⏳ Waiting",
  manual: "👤 Manual",
  approved: "✅ Approved",
  rejected: "❌ Rejected",
};

/** Maps latest job_notifications row to a card badge, if any. */
export function notificationToCardBadge(
  type: NotificationType,
  status: NotificationStatus,
  channel: NotificationChannel,
  customerResponse: CustomerResponse | null
): CardNotificationBadge | null {
  if (type === "customer_approval") {
    if (status === "responded") {
      if (customerResponse === "approved") return "approved";
      if (customerResponse === "changes_requested") return "rejected";
      return null;
    }
    if (status === "pending" || status === "sent") {
      if (channel === "manual") return "manual";
      if (channel === "email" || channel === "sms" || channel === "both") {
        return "waiting_approval";
      }
    }
    return null;
  }

  if (status === "pending" || status === "sent") {
    if (channel === "manual") return "manual";
    return "waiting";
  }
  if (status !== "responded") return null;
  if (customerResponse === "info_submitted") return "responded";
  return "responded";
}
