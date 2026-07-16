"use client";

import { useMemo, useState } from "react";
import { Mail, MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  buildMissingInfoMessage,
  buildMissingInfoSmsBody,
  customerContactFromOrder,
  customerNameFromOrder,
  missingInfoSubject,
  productFromOrder,
} from "@/lib/notification-messages";
import {
  defaultSendChannel,
  destinationForChannel,
} from "@/lib/preferred-channel";
import { postJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { validateSmsRecipient } from "@/lib/sms";
import { cn } from "@/lib/utils";
import type { CustomField, OrderWithRelations } from "@/lib/types";

interface Props {
  order: OrderWithRelations;
  tenantName: string;
  customFields: CustomField[];
  fieldValues: Record<string, unknown>;
  smsConfigured: boolean;
  publicAppUrl: boolean;
  onClose: () => void;
  dismissing?: boolean;
  onSent: (toastMessage: string) => void;
}

export function MissingInfoPopup({
  order,
  tenantName,
  customFields,
  fieldValues,
  smsConfigured,
  publicAppUrl,
  onClose,
  dismissing = false,
  onSent,
}: Props) {
  const contact = useMemo(
    () => customerContactFromOrder(order, fieldValues, customFields),
    [order, fieldValues, customFields]
  );
  const customerName = useMemo(
    () => customerNameFromOrder(order, fieldValues, customFields),
    [order, fieldValues, customFields]
  );
  const product = useMemo(
    () => productFromOrder(fieldValues, customFields),
    [fieldValues, customFields]
  );

  const [channel, setChannel] = useState<"email" | "sms">(() =>
    defaultSendChannel(
      contact,
      order.customer?.preferred_channel,
      smsConfigured
    )
  );
  const [to, setTo] = useState(() =>
    destinationForChannel(
      contact,
      defaultSendChannel(
        contact,
        order.customer?.preferred_channel,
        smsConfigured
      )
    )
  );
  const [subject, setSubject] = useState(() => missingInfoSubject(order.title));
  const [internalNote, setInternalNote] = useState("");
  const emailPreview = useMemo(
    () =>
      buildMissingInfoMessage({
        customerName,
        product,
        orderNumber: order.title,
        tenantName: `${tenantName} Team`,
        staffNote: internalNote.trim() || null,
      }),
    [customerName, product, order.title, tenantName, internalNote]
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveAndSend() {
    if (!internalNote.trim()) {
      setError("Please describe what's missing (internal note).");
      return;
    }
    const destination = to.trim();
    if (!destination) {
      setError(
        channel === "email"
          ? "Customer email is required."
          : "Customer phone number is required."
      );
      return;
    }
    if (channel === "sms") {
      const smsError = validateSmsRecipient(destination);
      if (smsError) {
        setError(smsError);
        return;
      }
    }
    if (channel === "email" && !internalNote.trim()) {
      setError("Please describe what's missing (internal note).");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const { ok, data } = await postJsonWithTimeout<{ error?: string }>(
        "/api/notifications/send",
        {
          orderId: order.id,
          type: "missing_info",
          channel,
          staffNote: internalNote.trim(),
          subject: channel === "email" ? subject.trim() : undefined,
          messageBody: undefined,
          toEmail: channel === "email" ? destination : undefined,
          toPhone: channel === "sms" ? destination : undefined,
        }
      );
      if (!ok) {
        setError(
          data.error ??
            (channel === "sms"
              ? "SMS failed to send. Please check Twilio config."
              : "Email failed. Check INSTANTLY_API_KEY.")
        );
        return;
      }
      onSent(
        channel === "email"
          ? `Email sent to ${customerName}`
          : `SMS sent to ${destination}`
      );
    } catch {
      setError(
        channel === "sms"
          ? "SMS failed to send. Please check Twilio config."
          : "Email failed. Check INSTANTLY_API_KEY."
      );
    } finally {
      setLoading(false);
    }
  }

  function switchChannel(next: "email" | "sms") {
    setChannel(next);
    setTo(next === "email" ? (contact.email ?? "") : (contact.phone ?? ""));
    setError(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        role="dialog"
        aria-labelledby="missing-info-popup-title"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2
              id="missing-info-popup-title"
              className="text-base font-semibold text-slate-800"
            >
              Notify customer — missing info
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {order.title}
              {customerName !== "there" ? ` · ${customerName}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading || dismissing}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Send via:</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => switchChannel("email")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  channel === "email"
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                <Mail className="h-4 w-4" />
                Email
              </button>
              <button
                type="button"
                onClick={() => switchChannel("sms")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  channel === "sms"
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                <MessageSquare className="h-4 w-4" />
                SMS
              </button>
            </div>
          </div>

          <div>
            <Label htmlFor="notify-to">To</Label>
            <Input
              id="notify-to"
              type={channel === "email" ? "email" : "tel"}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={
                channel === "email"
                  ? "customer@example.com"
                  : "+1 555 123 4567"
              }
            />
            {channel === "sms" && !contact.phone && contact.email ? (
              <p className="mt-1 text-xs text-amber-700">
                This customer only has an email on file. Enter a mobile number to
                send SMS.
              </p>
            ) : null}
            {channel === "sms" && !smsConfigured ? (
              <p className="mt-1 text-xs text-amber-700">
                Twilio is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
                and TWILIO_PHONE_NUMBER to .env.local, then restart the dev server.
              </p>
            ) : null}
            {channel === "sms" && smsConfigured && !publicAppUrl ? (
              <p className="mt-1 text-xs text-slate-500">
                Reply links use localhost and won&apos;t open on a customer&apos;s
                phone until you set NEXT_PUBLIC_APP_URL to your public domain (or
                ngrok) and restart the dev server.
              </p>
            ) : null}
          </div>

          {channel === "email" ? (
            <div>
              <Label htmlFor="notify-subject">Subject</Label>
              <Input
                id="notify-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          ) : null}

          <div>
            <Label htmlFor="notify-message">Email preview</Label>
            {channel === "sms" ? (
              <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {buildMissingInfoSmsBody({
                  customerName,
                  orderNumber: order.title,
                  replyLink: "[reply link added on send]",
                  brandName: tenantName,
                })}
              </p>
            ) : (
              <pre
                id="notify-message"
                className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-sans text-sm leading-relaxed text-slate-600"
              >
                {emailPreview}
              </pre>
            )}
            <p className="mt-1 text-xs text-slate-400">
              {channel === "sms"
                ? "SMS uses a short message with the reply link — not the full email text."
                : "Formatted email sent to the customer. The reply link is added automatically."}
            </p>
          </div>

          <div>
            <Label htmlFor="notify-internal">
              What&apos;s missing{" "}
              <span className="font-normal text-slate-400">
                {channel === "email"
                  ? "(shown to customer in the email)"
                  : "(not sent via SMS)"}
              </span>
            </Label>
            <Textarea
              id="notify-internal"
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              placeholder="e.g. Updated artwork file, Pantone color reference…"
              rows={3}
            />
          </div>

          {error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button variant="ghost" onClick={onClose} disabled={loading || dismissing}>
            Cancel
          </Button>
          <Button onClick={saveAndSend} disabled={loading || dismissing}>
            {loading ? "Sending…" : "Save & send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
