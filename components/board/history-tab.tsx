"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail, MessageSquare, Send } from "lucide-react";
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
import type { OrderSmsMessage } from "@/lib/order-sms-types";

interface HistoryTabProps {
  orderId: string;
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
  if (channel === "both") {
    return (
      <span className="inline-flex items-center">
        <Mail className="h-3.5 w-3.5 shrink-0" />
        <MessageSquare className="-ml-0.5 h-3.5 w-3.5 shrink-0" />
      </span>
    );
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

type TimelineSms = {
  kind: "sms";
  id: string;
  created_at: string;
  message: OrderSmsMessage;
};

type TimelineActivity = {
  kind: "activity";
  id: string;
  created_at: string;
  msg: SentMessageEntry;
};

type TimelineItem = TimelineSms | TimelineActivity;

const SAME_SEND_MS = 120_000;

function normalizeMessageBody(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function respondPath(value: string): string | null {
  const match = value.match(/\/respond\/[a-z0-9-]+/i);
  return match ? match[0].toLowerCase() : null;
}

function sameOutboundSend(
  sms: OrderSmsMessage,
  activityMsg: SentMessageEntry,
  reconstructedBody: string | null
): boolean {
  if (sms.direction !== "outbound") return false;
  const delta = Math.abs(
    new Date(sms.created_at).getTime() -
      new Date(activityMsg.created_at).getTime()
  );
  if (delta > SAME_SEND_MS) return false;

  const smsBody = normalizeMessageBody(sms.body);
  const bodies = [activityMsg.messageBody, reconstructedBody]
    .filter((b): b is string => Boolean(b?.trim()))
    .map(normalizeMessageBody);
  if (bodies.some((b) => b === smsBody || b.includes(smsBody) || smsBody.includes(b))) {
    return true;
  }

  const smsLink = respondPath(sms.body);
  if (
    smsLink &&
    bodies.some((b) => respondPath(b) === smsLink)
  ) {
    return true;
  }

  return activityMsg.channel === "both" && delta <= 30_000;
}

function mergeRecipient(
  existing: string | null | undefined,
  phone: string
): string {
  const parts = (existing ?? "")
    .split(/[·,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.some((p) => p.replace(/\s+/g, "") === phone.replace(/\s+/g, ""))) {
    return existing ?? phone;
  }
  return parts.length > 0 ? `${parts.join(" · ")} · ${phone}` : phone;
}

function SmsComposer({
  orderId,
  contactPhone,
  smsConfigured,
  onSent,
}: {
  orderId: string;
  contactPhone?: string | null;
  smsConfigured: boolean;
  onSent: (message: OrderSmsMessage) => void;
}) {
  const [phone, setPhone] = useState(contactPhone?.trim() ?? "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (contactPhone?.trim() && !phone.trim()) {
      setPhone(contactPhone.trim());
    }
  }, [contactPhone, phone]);

  async function handleSend() {
    setError(null);
    if (!phone.trim() || !body.trim()) {
      setError("Phone and message are required.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), body: body.trim() }),
      });
      const json = (await res.json()) as {
        message?: OrderSmsMessage;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to send SMS");
      setBody("");
      if (json.message) onSent(json.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send SMS");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/40 p-4">
      <p className="text-xs font-semibold text-slate-700">Send manual SMS</p>
      {!smsConfigured ? (
        <p className="text-xs text-amber-700">
          Twilio is not configured. Add TWILIO_* env vars to send SMS.
        </p>
      ) : null}
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="+1 818 555 1234"
        className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-300"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Type your message…"
        className="w-full resize-none rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-300"
      />
      {error ? (
        <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-600">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sending || !smsConfigured || !phone.trim() || !body.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {sending ? "Sending…" : "Send SMS"}
        </button>
      </div>
    </div>
  );
}

function CommunicationRow({
  createdAt,
  owner,
  channel,
  title,
  to,
  subject,
  body,
  reconstructed,
  inbound,
}: {
  createdAt: string;
  owner: string;
  channel: string;
  title?: string | null;
  to?: string | null;
  subject?: string | null;
  body?: string | null;
  reconstructed?: boolean;
  inbound?: boolean;
}) {
  return (
    <li className={cn("px-4 py-3", inbound && "bg-violet-50/40")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm text-slate-800">
          <span className="font-semibold">{formatDateTime(createdAt)}</span>
          <span className="mx-1.5 text-slate-300">·</span>
          <span className="font-medium text-slate-700">{owner}</span>
        </p>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
            inbound
              ? "bg-violet-100 text-violet-700"
              : channel === "sms"
                ? "bg-sky-50 text-sky-700"
                : channel === "email"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-600"
          )}
        >
          <ChannelIcon channel={inbound ? "sms" : channel} />
          {inbound ? "SMS reply" : channelLabel(channel)}
        </span>
      </div>
      {title ? (
        <p className="mt-0.5 text-xs font-medium text-slate-600">{title}</p>
      ) : null}
      {to ? (
        <p className="mt-0.5 text-xs text-slate-500">
          {inbound ? "From" : "To"}: {to}
        </p>
      ) : null}
      {subject ? (
        <p className="mt-1 text-xs font-medium text-slate-600">
          Subject: {subject}
        </p>
      ) : null}
      {body ? (
        <>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
            {body}
          </pre>
          {reconstructed ? (
            <p className="mt-1.5 text-[11px] italic text-slate-400">
              Reconstructed from current templates (exact wording at send time
              was not stored).
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-xs text-slate-400">
          Message body was not stored for this send.
        </p>
      )}
    </li>
  );
}

export function HistoryTab(props: HistoryTabProps) {
  const { activity, contactEmail, contactPhone, orderId } = props;
  const [smsMessages, setSmsMessages] = useState<OrderSmsMessage[]>([]);
  const [smsConfigured, setSmsConfigured] = useState(true);
  const [smsLoading, setSmsLoading] = useState(true);
  const [smsError, setSmsError] = useState<string | null>(null);

  const loadSms = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}/sms`);
      const json = (await res.json()) as {
        messages?: OrderSmsMessage[];
        smsConfigured?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to load SMS");
      setSmsMessages(json.messages ?? []);
      setSmsConfigured(json.smsConfigured !== false);
      setSmsError(null);
    } catch (err) {
      setSmsError(err instanceof Error ? err.message : "Failed to load SMS");
    } finally {
      setSmsLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void loadSms();
  }, [loadSms]);

  // Email/both + legacy SMS that were never stored in order_sms_messages.
  // New SMS (with Twilio SID) live only in the SMS thread so they aren't duplicated.
  const activityMessages = sentMessagesFromActivity(activity).filter((m) => {
    if (
      m.channel === "email" ||
      m.channel === "both" ||
      m.channel === "unknown"
    ) {
      return true;
    }
    if (m.channel !== "sms") return false;
    const log = activity.find((a) => a.id === m.id);
    const meta = (log?.metadata ?? {}) as Record<string, unknown>;
    const sid =
      typeof meta.twilioSid === "string" ? meta.twilioSid.trim() : "";
    if (sid) return false;
    return true;
  });

  const activityWithBody = activityMessages.map((msg) => ({
    msg,
    reconstructed: reconstructMessage(msg, activity, props),
  }));

  const coveredSmsIds = new Set<string>();
  const mergedActivity = activityWithBody.map(({ msg, reconstructed }) => {
    let next = msg;
    for (const sms of smsMessages) {
      if (coveredSmsIds.has(sms.id)) continue;
      if (
        !sameOutboundSend(sms, msg, reconstructed.messageBody)
      ) {
        continue;
      }
      coveredSmsIds.add(sms.id);
      const baseTo =
        next.to ??
        (next.channel === "sms"
          ? contactPhone
          : next.channel === "email"
            ? contactEmail
            : [contactEmail, contactPhone].filter(Boolean).join(" · ") ||
              null);
      next = {
        ...next,
        to: mergeRecipient(baseTo, sms.phone),
        channel: next.channel === "email" ? "both" : next.channel,
      };
    }
    return { msg: next, reconstructed };
  });

  const timeline: TimelineItem[] = [
    ...smsMessages
      .filter((message) => !coveredSmsIds.has(message.id))
      .map(
        (message): TimelineSms => ({
          kind: "sms",
          id: `sms-${message.id}`,
          created_at: message.created_at,
          message,
        })
      ),
    ...mergedActivity.map(
      ({ msg }): TimelineActivity => ({
        kind: "activity",
        id: `act-${msg.id}`,
        created_at: msg.created_at,
        msg,
      })
    ),
  ].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">
          All communication
        </h3>
        {smsError ? (
          <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-600">
            {smsError}
          </p>
        ) : null}
        {smsLoading && timeline.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
            Loading communication…
          </div>
        ) : timeline.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Nothing sent to the client yet. Email, SMS, and customer replies
            all show here.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100">
              {timeline.map((item) => {
                if (item.kind === "sms") {
                  const inbound = item.message.direction !== "outbound";
                  return (
                    <CommunicationRow
                      key={item.id}
                      createdAt={item.message.created_at}
                      owner={
                        inbound
                          ? "Customer"
                          : item.message.actor_name?.trim() || "Team"
                      }
                      channel="sms"
                      title={inbound ? "Customer replied" : "SMS sent"}
                      to={item.message.phone}
                      body={item.message.body}
                      inbound={inbound}
                    />
                  );
                }

                const msg = item.msg;
                const content = reconstructMessage(msg, activity, props);
                const to =
                  msg.to ??
                  (msg.channel === "sms"
                    ? contactPhone
                    : msg.channel === "email"
                      ? contactEmail
                      : [contactEmail, contactPhone]
                          .filter(Boolean)
                          .join(" · ") || null);

                return (
                  <CommunicationRow
                    key={item.id}
                    createdAt={msg.created_at}
                    owner={msg.actor_name?.trim() || "Team"}
                    channel={msg.channel}
                    title={
                      msg.channel === "sms" ? "SMS sent" : msg.title
                    }
                    to={to}
                    subject={content.subject}
                    body={content.messageBody}
                    reconstructed={content.reconstructed}
                  />
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <SmsComposer
        orderId={orderId}
        contactPhone={contactPhone}
        smsConfigured={smsConfigured}
        onSent={(message) => {
          setSmsMessages((prev) =>
            prev.some((m) => m.id === message.id) ? prev : [...prev, message]
          );
        }}
      />
    </div>
  );
}
