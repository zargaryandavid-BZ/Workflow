"use client";

import { Mail, MessageSquare } from "lucide-react";
import {
  sentMessagesFromActivity,
  type ActivityLogEntry,
  type SentMessageEntry,
} from "@/lib/activity";
import {
  buildApprovalSmsBody,
  buildMissingInfoSmsBody,
  buildReadyToShipSmsBody,
  buildShippingPortalEmailBody,
  buildShippingPortalSmsBody,
  respondUrl,
} from "@/lib/notification-messages";
import { cn, formatDateTime } from "@/lib/utils";
import type { JobNotification, ShippingRequest } from "@/lib/types";

interface HistoryTabProps {
  activity: ActivityLogEntry[];
  orderNumber: string;
  customerName?: string | null;
  productLabel?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  appUrl?: string;
  tenantName?: string;
  notifications?: JobNotification[];
  shippingRequest?: ShippingRequest | null;
}

function channelLabel(channel: string) {
  if (channel === "both") return "Email + SMS";
  if (channel === "sms") return "SMS";
  if (channel === "email") return "Email";
  return "Message";
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "sms") {
    return <MessageSquare className="h-3.5 w-3.5 shrink-0" />;
  }
  return <Mail className="h-3.5 w-3.5 shrink-0" />;
}

function publicBase(appUrl?: string) {
  const base = (appUrl || process.env.NEXT_PUBLIC_APP_URL || "").replace(
    /\/$/,
    ""
  );
  return base || null;
}

function respondLink(token: string, appUrl?: string) {
  const base = publicBase(appUrl);
  if (base) return `${base}/respond/${token}`;
  return respondUrl(token);
}

function shippingPortalLink(token: string, appUrl?: string) {
  const base = publicBase(appUrl);
  if (base) return `${base}/shipping/${token}`;
  return `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/shipping/${token}`;
}

function findNotification(
  notificationId: string | null,
  notifyType: string | null,
  createdAt: string,
  notifications: JobNotification[]
) {
  if (notificationId) {
    const byId = notifications.find((n) => n.id === notificationId);
    if (byId) return byId;
  }
  if (!notifyType) return null;
  const sameType = notifications.filter((n) => n.type === notifyType);
  if (sameType.length === 0) return null;
  const target = new Date(createdAt).getTime();
  return sameType.reduce((best, n) => {
    const bestDelta = Math.abs(new Date(best.created_at).getTime() - target);
    const nextDelta = Math.abs(new Date(n.created_at).getTime() - target);
    return nextDelta < bestDelta ? n : best;
  });
}

function reconstructMessage(
  msg: SentMessageEntry,
  activity: ActivityLogEntry[],
  props: HistoryTabProps
): {
  subject: string | null;
  messageBody: string | null;
  reconstructed: boolean;
} {
  if (msg.messageBody) {
    return {
      subject: msg.subject,
      messageBody: msg.messageBody,
      reconstructed: false,
    };
  }

  const log = activity.find((a) => a.id === msg.id);
  const meta = (log?.metadata ?? {}) as Record<string, unknown>;
  const customerName = props.customerName ?? "there";
  const orderNumber = props.orderNumber;
  const product = props.productLabel?.trim() || "print";
  const brand = props.tenantName?.trim() || "BazaarPrinting";
  const notificationId =
    typeof meta.notificationId === "string" ? meta.notificationId : null;
  const type = typeof meta.type === "string" ? meta.type : null;
  const portalUrl =
    typeof meta.portalUrl === "string" && meta.portalUrl.trim()
      ? meta.portalUrl.trim()
      : null;
  const token =
    typeof meta.token === "string" && meta.token.trim()
      ? meta.token.trim()
      : null;

  const note = findNotification(
    notificationId,
    type,
    msg.created_at,
    props.notifications ?? []
  );

  if (msg.action === "shipping_link_sent") {
    const url =
      portalUrl ??
      (token ? shippingPortalLink(token, props.appUrl) : null) ??
      (props.shippingRequest?.token
        ? shippingPortalLink(props.shippingRequest.token, props.appUrl)
        : null);
    if (url) {
      if (msg.channel === "email") {
        return {
          subject: msg.subject,
          messageBody: buildShippingPortalEmailBody({
            customerName,
            orderNumber,
            portalUrl: url,
            teamName: `${brand} Team`,
          }),
          reconstructed: true,
        };
      }
      return {
        subject: null,
        messageBody: buildShippingPortalSmsBody({
          customerName,
          orderNumber,
          portalUrl: url,
        }),
        reconstructed: true,
      };
    }
  }

  if (msg.action === "customer_notified" || type || note) {
    const notifyType = type ?? note?.type ?? null;
    const actionUrl = note?.token
      ? respondLink(note.token, props.appUrl)
      : null;

    if (notifyType === "customer_approval" && actionUrl) {
      return {
        subject: msg.subject,
        messageBody: buildApprovalSmsBody({
          customerName,
          productType: product,
          orderNumber,
          approvalLink: actionUrl,
          brandName: brand,
        }),
        reconstructed: true,
      };
    }

    if (notifyType === "missing_info" && actionUrl) {
      return {
        subject: msg.subject,
        messageBody: buildMissingInfoSmsBody({
          customerName,
          orderNumber,
          replyLink: actionUrl,
          brandName: brand,
        }),
        reconstructed: true,
      };
    }

    if (notifyType === "ready_to_ship" && actionUrl) {
      return {
        subject: msg.subject,
        messageBody: buildReadyToShipSmsBody({
          customerName,
          orderNumber,
          orderLink: actionUrl,
          brandName: brand,
          staffNote: note?.staff_note,
        }),
        reconstructed: true,
      };
    }
  }

  return {
    subject: msg.subject,
    messageBody: null,
    reconstructed: false,
  };
}

export function HistoryTab(props: HistoryTabProps) {
  const { activity, contactEmail, contactPhone } = props;
  const messages = sentMessagesFromActivity(activity);

  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        No messages sent yet. Email and SMS from this card will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((msg) => {
        const content = reconstructMessage(msg, activity, props);
        const to =
          msg.to ??
          (msg.channel === "sms"
            ? contactPhone
            : msg.channel === "email"
              ? contactEmail
              : [contactEmail, contactPhone].filter(Boolean).join(" · ") ||
                null);

        return (
          <article
            key={msg.id}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      msg.channel === "sms"
                        ? "bg-sky-50 text-sky-700"
                        : msg.channel === "email"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                    )}
                  >
                    <ChannelIcon channel={msg.channel} />
                    {channelLabel(msg.channel)}
                  </span>
                  <h3 className="text-sm font-semibold text-slate-800">
                    {msg.title}
                  </h3>
                </div>
                {to ? (
                  <p className="mt-1 text-xs text-slate-500">To: {to}</p>
                ) : null}
              </div>
              <div className="text-right text-xs text-slate-400">
                <div>{formatDateTime(msg.created_at)}</div>
                {msg.actor_name ? (
                  <div className="mt-0.5">by {msg.actor_name}</div>
                ) : null}
              </div>
            </div>

            {content.subject ? (
              <p className="mt-3 text-xs font-medium text-slate-600">
                Subject: {content.subject}
              </p>
            ) : null}

            {content.messageBody ? (
              <>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
                  {content.messageBody}
                </pre>
                {content.reconstructed ? (
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    Reconstructed from current templates (exact wording at send
                    time was not stored).
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-xs italic text-slate-400">
                Message content was not recorded for this send.
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
