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
  channelFromSelection,
  defaultSendChannels,
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

  const [selected, setSelected] = useState<Array<"email" | "sms">>(() =>
    defaultSendChannels(
      contact,
      order.customer?.preferred_channel,
      smsConfigured
    )
  );
  const [email, setEmail] = useState(contact.email ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
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

  const wantEmail = selected.includes("email");
  const wantSms = selected.includes("sms");

  function toggleChannel(next: "email" | "sms") {
    setSelected((prev) => {
      if (prev.includes(next)) {
        const nextSel = prev.filter((c) => c !== next);
        return nextSel.length === 0 ? prev : nextSel;
      }
      return [...prev, next];
    });
    setError(null);
  }

  async function saveAndSend() {
    if (!internalNote.trim()) {
      setError("Please describe what's missing (internal note).");
      return;
    }
    const channel = channelFromSelection(selected);
    if (!channel) {
      setError("Select Email, SMS, or both.");
      return;
    }
    if (wantEmail && !email.trim()) {
      setError("Customer email is required.");
      return;
    }
    if (wantSms) {
      const smsError = validateSmsRecipient(phone);
      if (smsError) {
        setError(smsError);
        return;
      }
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
          subject: wantEmail ? subject.trim() : undefined,
          messageBody: undefined,
          toEmail: wantEmail ? email.trim() || undefined : undefined,
          toPhone: wantSms ? phone.trim() || undefined : undefined,
        }
      );
      if (!ok) {
        setError(
          data.error ??
            (wantSms && !wantEmail
              ? "SMS failed to send. Please check Twilio config."
              : "Email failed. Check INSTANTLY_API_KEY.")
        );
        return;
      }
      if (channel === "both") {
        onSent(`Email + SMS sent to ${customerName}`);
      } else if (channel === "email") {
        onSent(`Email sent to ${customerName}`);
      } else {
        onSent(`SMS sent to ${phone.trim()}`);
      }
    } catch {
      setError(
        wantSms && !wantEmail
          ? "SMS failed to send. Please check Twilio config."
          : "Email failed. Check INSTANTLY_API_KEY."
      );
    } finally {
      setLoading(false);
    }
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
            <p className="mb-2 text-sm font-medium text-slate-700">
              Send via (select one or both):
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => toggleChannel("email")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  wantEmail
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                <Mail className="h-4 w-4" />
                Email
              </button>
              <button
                type="button"
                onClick={() => toggleChannel("sms")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  wantSms
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                <MessageSquare className="h-4 w-4" />
                SMS
              </button>
            </div>
          </div>

          {wantEmail ? (
            <div>
              <Label htmlFor="notify-email">Email</Label>
              <Input
                id="notify-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
              />
            </div>
          ) : null}

          {wantSms ? (
            <div>
              <Label htmlFor="notify-phone">Phone</Label>
              <Input
                id="notify-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 123 4567"
              />
              {!contact.phone && contact.email ? (
                <p className="mt-1 text-xs text-amber-700">
                  This customer only has an email on file. Enter a mobile number
                  to send SMS.
                </p>
              ) : null}
              {!smsConfigured ? (
                <p className="mt-1 text-xs text-amber-700">
                  Twilio is not configured. Add TWILIO_ACCOUNT_SID,
                  TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER to .env.local, then
                  restart the dev server.
                </p>
              ) : null}
              {smsConfigured && !publicAppUrl ? (
                <p className="mt-1 text-xs text-slate-500">
                  Reply links use localhost and won&apos;t open on a
                  customer&apos;s phone until you set NEXT_PUBLIC_APP_URL to
                  your public domain (or ngrok) and restart the dev server.
                </p>
              ) : null}
            </div>
          ) : null}

          {wantEmail ? (
            <div>
              <Label htmlFor="notify-subject">Subject</Label>
              <Input
                id="notify-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          ) : null}

          {wantEmail ? (
            <div>
              <Label htmlFor="notify-message">Email preview</Label>
              <pre
                id="notify-message"
                className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-sans text-sm leading-relaxed text-slate-600"
              >
                {emailPreview}
              </pre>
              <p className="mt-1 text-xs text-slate-400">
                Formatted email sent to the customer. The reply link is added
                automatically.
              </p>
            </div>
          ) : null}

          {wantSms ? (
            <div>
              <Label>SMS preview</Label>
              <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {buildMissingInfoSmsBody({
                  customerName,
                  orderNumber: order.title,
                  replyLink: "[reply link added on send]",
                  brandName: tenantName,
                })}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                SMS uses a short message with the reply link — not the full
                email text.
              </p>
            </div>
          ) : null}

          <div>
            <Label htmlFor="notify-internal">
              What&apos;s missing{" "}
              <span className="font-normal text-slate-400">
                {wantEmail
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
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={loading || dismissing}
          >
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
