"use client";

import { useMemo, useState } from "react";
import { Mail, MessageSquare, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  approvalSubject,
  buildApprovalEmailBody,
  buildApprovalSmsBody,
  customerContactFromOrder,
  customerNameFromOrder,
  productFromOrder,
} from "@/lib/notification-messages";
import {
  destinationForChannel,
  resolvePreferredNotifyChannel,
} from "@/lib/preferred-channel";
import { postJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { validateSmsRecipient } from "@/lib/sms";
import { cn } from "@/lib/utils";
import type { CustomField, OrderWithRelations } from "@/lib/types";

type Channel = "email" | "sms" | "manual";

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

export function ApprovalPopup({
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

  const [channel, setChannel] = useState<Channel>(() =>
    resolvePreferredNotifyChannel(
      contact,
      order.customer?.preferred_channel,
      smsConfigured
    )
  );
  const [to, setTo] = useState(() => {
    const initial = resolvePreferredNotifyChannel(
      contact,
      order.customer?.preferred_channel,
      smsConfigured
    );
    if (initial === "manual") return "";
    return destinationForChannel(contact, initial);
  });
  const [subject, setSubject] = useState(() => approvalSubject(order.title));
  const [emailMessage, setEmailMessage] = useState(() =>
    buildApprovalEmailBody({
      customerName: customerNameFromOrder(order, fieldValues, customFields),
      productType: productFromOrder(fieldValues, customFields),
      orderNumber: order.title,
      approvalLink: "[reply link added on send]",
      teamName: `${tenantName} Team`,
    })
  );
  const [staffNote, setStaffNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveAndSend() {
    setError(null);

    if (channel !== "manual") {
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
      if (channel === "email" && !emailMessage.trim()) {
        setError("Email message is required.");
        return;
      }
    }

    setLoading(true);
    try {
      const emailBody =
        channel === "email"
          ? appendStaffNoteToEmail(emailMessage, staffNote)
          : undefined;
      const { ok, data } = await postJsonWithTimeout<{ error?: string }>(
        "/api/notifications/send",
        {
          orderId: order.id,
          type: "customer_approval",
          channel,
          staffNote: staffNote.trim() || undefined,
          subject: channel === "email" ? subject.trim() : undefined,
          messageBody:
            channel === "email"
              ? emailBody
              : channel === "sms"
                ? buildApprovalSmsBody({
                    customerName,
                    productType: product,
                    orderNumber: order.title,
                    approvalLink: "[reply link added on send]",
                    brandName: tenantName,
                  })
                : undefined,
          toEmail: channel === "email" ? to.trim() || undefined : undefined,
          toPhone: channel === "sms" ? to.trim() || undefined : undefined,
        }
      );
      if (!ok) {
        setError(
          data.error ??
            (channel === "sms"
              ? "SMS failed to send. Please check Twilio config."
              : channel === "email"
                ? "Email failed. Check INSTANTLY_API_KEY."
                : "Failed to save")
        );
        return;
      }
      if (channel === "manual") {
        onSent("Saved — manual follow-up");
      } else if (channel === "email") {
        onSent(`Approval request sent to ${customerName}`);
      } else {
        onSent(`SMS sent to ${to.trim()}`);
      }
    } catch {
      setError(
        channel === "sms"
          ? "SMS failed to send. Please check Twilio config."
          : channel === "email"
            ? "Email failed. Check INSTANTLY_API_KEY."
            : "Failed to save"
      );
    } finally {
      setLoading(false);
    }
  }

  function switchChannel(next: Channel) {
    setChannel(next);
    if (next === "email") setTo(contact.email ?? "");
    else if (next === "sms") setTo(contact.phone ?? "");
    setError(null);
  }

  const isManual = channel === "manual";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        role="dialog"
        aria-labelledby="approval-popup-title"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2
              id="approval-popup-title"
              className="text-base font-semibold text-slate-800"
            >
              Request customer approval
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
              How would you like to notify the customer?
            </p>
            <div className="flex flex-wrap gap-2">
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
              <button
                type="button"
                onClick={() => switchChannel("manual")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  channel === "manual"
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                <User className="h-4 w-4" />
                Manual
              </button>
            </div>
          </div>

          {isManual ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              You&apos;ve selected manual follow-up. The card will be tagged as
              Manual on the board.
            </p>
          ) : (
            <>
              <div>
                <Label htmlFor="approval-to">To</Label>
                <Input
                  id="approval-to"
                  type={channel === "email" ? "email" : "tel"}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder={
                    channel === "email"
                      ? "customer@example.com"
                      : "+1 555 123 4567"
                  }
                />
                {channel === "sms" && !smsConfigured ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Twilio is not configured. Add Twilio credentials to
                    .env.local and restart the dev server.
                  </p>
                ) : null}
                {channel === "sms" && smsConfigured && !publicAppUrl ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Approval links use localhost and won&apos;t open on a
                    customer&apos;s phone until you set NEXT_PUBLIC_APP_URL to
                    your public domain.
                  </p>
                ) : null}
              </div>

              {channel === "email" ? (
                <>
                  <div>
                    <Label htmlFor="approval-subject">Subject</Label>
                    <Input
                      id="approval-subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="approval-message">Email message</Label>
                    <Textarea
                      id="approval-message"
                      value={emailMessage}
                      onChange={(e) => setEmailMessage(e.target.value)}
                      rows={12}
                      className="mt-1 font-sans text-sm leading-relaxed"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      Edit the email sent to the customer. Keep{" "}
                      <span className="font-mono">[reply link added on send]</span>{" "}
                      where the approval link should appear.
                    </p>
                  </div>
                </>
              ) : (
                <div>
                  <Label>Message preview (SMS)</Label>
                  <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {buildApprovalSmsBody({
                      customerName,
                      productType: product,
                      orderNumber: order.title,
                      approvalLink: "[reply link added on send]",
                      brandName: tenantName,
                    })}
                  </p>
                </div>
              )}
            </>
          )}

          <div>
            <Label htmlFor="approval-note">
              Note for customer{" "}
              <span className="font-normal text-slate-400">(optional)</span>
            </Label>
            <Textarea
              id="approval-note"
              value={staffNote}
              onChange={(e) => setStaffNote(e.target.value)}
              placeholder="Anything you'd like the customer to know before approving…"
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
            {loading
              ? "Saving…"
              : isManual
                ? "Save"
                : "Send & notify"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function appendStaffNoteToEmail(body: string, note: string) {
  const trimmed = note.trim();
  if (!trimmed) return body.trim();
  return `${body.trim()}\n\nNote from our team:\n${trimmed}`;
}
