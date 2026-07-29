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

function SmsThread({
  orderId,
  contactPhone,
}: {
  orderId: string;
  contactPhone?: string | null;
}) {
  const [messages, setMessages] = useState<OrderSmsMessage[]>([]);
  const [smsConfigured, setSmsConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState(contactPhone?.trim() ?? "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}/sms`);
      const json = (await res.json()) as {
        messages?: OrderSmsMessage[];
        smsConfigured?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to load SMS");
      setMessages(json.messages ?? []);
      setSmsConfigured(json.smsConfigured !== false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load SMS");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

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
      if (json.message) {
        setMessages((prev) => [...prev, json.message!]);
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send SMS");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/40 p-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-sky-700" />
        <h3 className="text-sm font-semibold text-slate-800">SMS conversation</h3>
      </div>

      {loading ? (
        <p className="text-xs text-slate-500">Loading SMS…</p>
      ) : messages.length === 0 ? (
        <p className="text-xs text-slate-500">
          No SMS yet. Send a manual message below — client replies appear here
          when Twilio inbound is configured.
        </p>
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-white p-3">
          {messages.map((m) => {
            const outbound = m.direction === "outbound";
            return (
              <div
                key={m.id}
                className={cn(
                  "flex",
                  outbound ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed",
                    outbound
                      ? "bg-sky-600 text-white"
                      : "bg-slate-100 text-slate-800"
                  )}
                >
                  <div
                    className={cn(
                      "mb-1 text-[10px] font-medium",
                      outbound ? "text-sky-100" : "text-slate-500"
                    )}
                  >
                    {outbound ? "You" : "Client"}
                    {" · "}
                    {formatDateTime(m.created_at)}
                    {outbound && m.actor_name ? ` · ${m.actor_name}` : null}
                  </div>
                  <pre className="whitespace-pre-wrap font-sans">{m.body}</pre>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2 border-t border-sky-100 pt-3">
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
            disabled={
              sending || !smsConfigured || !phone.trim() || !body.trim()
            }
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
    </div>
  );
}

export function HistoryTab(props: HistoryTabProps) {
  const { activity, contactEmail, contactPhone, orderId } = props;
  // Keep email/both/unknown. Also keep SMS from the activity log when they were
  // not migrated into order_sms_messages (new sends stamp twilioSid and appear
  // in the SMS conversation thread instead).
  const messages = sentMessagesFromActivity(activity).filter((m) => {
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
    // Already represented in SmsThread / order_sms_messages.
    if (sid) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <SmsThread orderId={orderId} contactPhone={contactPhone} />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">
          Email &amp; prior messages
        </h3>
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No email or prior SMS messages logged yet.
          </div>
        ) : (
          messages.map((msg) => {
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
                      <p className="mt-2 text-[11px] italic text-slate-400">
                        Reconstructed from current templates (exact wording at
                        send time was not stored).
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">
                    Message body was not stored for this send.
                  </p>
                )}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
