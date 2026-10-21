"use client";

import { formatDateTime } from "@/lib/utils";
import {
  sendsForNotification,
  type ActivityLogEntry,
} from "@/lib/activity";

/**
 * Earlier sends of the same request (resends reuse one notification row).
 * Shows which channel(s) each send actually used and where it went, so an
 * SMS-only send and a later Email + SMS resend are both visible.
 */
export function NotificationSendLog({
  activity,
  notificationId,
}: {
  activity: ActivityLogEntry[];
  notificationId: string;
}) {
  const sends = sendsForNotification(activity, notificationId);
  if (sends.length < 2) return null;
  return (
    <div className="mt-2">
      <p className="text-[11px] font-medium text-slate-400">
        All sends of this request
      </p>
      <ul className="mt-1 space-y-0.5">
        {sends.map((send) => (
          <li key={send.id} className="text-xs text-slate-600">
            <span className="text-slate-400">
              {formatDateTime(send.created_at)}
              {send.actor_name ? ` · ${send.actor_name}` : ""} ·{" "}
            </span>
            {send.line}
          </li>
        ))}
      </ul>
    </div>
  );
}
